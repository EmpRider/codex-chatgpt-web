import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint, defaultConfig, providerConfig } from "../src/config";
import { AgentResponsesSessionManager } from "../src/integrations/agent-responses/session-manager";
import { parseAgentResponsesRequest } from "../src/integrations/agent-responses/request";
import { createRequire } from "node:module";
import { AGENT_RESPONSES_ACTIVITY_PREFIX } from "../src/activity-events";

test("MCP diagnostics reach the Activity logger without corrupting JSON-RPC stdout", async () => {
  const require = createRequire(import.meta.url);
  const { parseGatewayActivityLine, createLogger } = require("../launcher/electron/logging.cjs");
  const root = mkdtempSync(join(tmpdir(), "cgw-mcp-activity-"));
  const logger = createLogger({ filePath: join(root, "activity.jsonl") });
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  const client = new Client({ name: "activity-test", version: "1" });
  const protocolErrors: Error[] = [];
  client.onerror = error => protocolErrors.push(error);
  const write = process.stdout.write.bind(process.stdout);
  const output = spyOn(process.stdout, "write").mockImplementation(((chunk: unknown, ...args: unknown[]) => {
    const line = String(chunk).trim();
    if (line.startsWith(AGENT_RESPONSES_ACTIVITY_PREFIX)) {
      const record = parseGatewayActivityLine(line);
      if (record) logger[record.level](record.event, record.detail);
    }
    return (write as Function)(chunk, ...args);
  }) as typeof process.stdout.write);
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath], cwd: process.cwd(), stderr: "pipe" });
  try {
    const token = await broker.register({ kind: "external-agent", tools: [{ name: "Read", description: "Fixture", parameters: { type: "object" } }] });
    await client.connect(transport);
    const pending = client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: token, wire_name: "Read", arguments: { path: "private-canary-path" },
    } });
    const batch = await broker.nextToolBatch(token);
    await broker.completeTool(token, batch[0]!.callId, { content: [{ type: "text", text: "private-canary-result" }] });
    await pending;
    expect(protocolErrors).toEqual([]);
    for (let i = 0; i < 100 && !logger.recent(300).some((row: { event: string }) => row.event === "agent_responses.mcp.reply_sent"); i++) await Bun.sleep(10);
    const records = logger.recent(300);
    expect(records.map((row: { event: string }) => row.event)).toContain("agent_responses.mcp.invoke_completed");
    expect(records.map((row: { event: string }) => row.event)).toContain("agent_responses.mcp.capability_observed");
    expect(records.find((row: { event: string }) => row.event === "agent_responses.mcp.capability_observed").detail.code).toBe("tasks_not_advertised");
    expect(records.map((row: { event: string }) => row.event)).toContain("agent_responses.mcp.call_received");
    const invocations = records.filter((row: { event: string }) => /mcp\.invoke_(started|completed)$/.test(row.event));
    expect(invocations).toHaveLength(2);
    expect(invocations[0].detail.request_hash).toMatch(/^[a-f0-9]{32}$/);
    expect(invocations[0].detail.request_hash).toBe(invocations[1].detail.request_hash);
    expect(invocations[0].detail.turn_hash).toBe(invocations[1].detail.turn_hash);
    expect(JSON.stringify(records)).not.toContain("private-canary");
    expect(JSON.stringify(records)).not.toContain(token);
    const before = records.length;
    await callTurnBroker(broker.socketPath, { method: "diagnostic", diagnostic: {
      level: "INFO", category: "mcp", event: "invoke_completed", phase: "completion", code: "ok",
      secret: "private-canary-forged",
    } } as Parameters<typeof callTurnBroker>[1]);
    expect(logger.recent(300).length).toBe(before);
    const failed = client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: token, wire_name: "Read", arguments: {},
    } });
    const failedBatch = await broker.nextToolBatch(token);
    await broker.completeTool(token, failedBatch[0]!.callId, { isError: true, content: [] });
    expect((await failed).isError).toBe(true);
    for (let i = 0; i < 100 && !logger.recent(300).some((row: { event: string; detail: { code: string } }) =>
      row.event === "agent_responses.mcp.invoke_completed" && row.detail.code === "internal"); i++) await Bun.sleep(10);
    expect(logger.recent(300)).toContainEqual(expect.objectContaining({ event: "agent_responses.mcp.invoke_completed",
      level: "warning", detail: expect.objectContaining({ code: "internal" }) }));
    expect(protocolErrors).toEqual([]);
  } finally {
    await client.close();
    await broker.close();
    output.mockRestore();
    rmSync(root, { recursive: true, force: true });
  }
}, 10_000);

test("aborting an undelivered external MCP call preserves its sibling and turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-agent-mcp-cancel-"));
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  const client = new Client({ name: "queued-cancel-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath],
    cwd: process.cwd(), stderr: "pipe",
  });
  let onQueue: (() => void) | undefined;
  let onSettled: (() => void) | undefined;
  const log = spyOn(console, "info").mockImplementation(message => {
    if (String(message).includes(" queued call=")) onQueue?.();
    if (/broker_retired|cancelled_before_delivery/.test(String(message))) onSettled?.();
  });
  try {
    await client.connect(transport);
    const token = await broker.register({ kind: "external-agent", tools: [{ name: "Read", description: "Read an agent-owned file", parameters: {
      type: "object", properties: { path: { type: "string" } }, required: ["path"],
    } }] });
    const abort = new AbortController();
    const queued = new Promise<void>(resolve => { onQueue = resolve; });
    const a = client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: token, wire_name: "Read", arguments: { path: "cancelled.ts" },
    } }, undefined, { signal: abort.signal }).then(() => "completed", () => "aborted");
    await queued;
    const settled = new Promise<void>(resolve => { onSettled = resolve; });
    abort.abort();
    expect(await a).toBe("aborted");
    await settled;
    const b = client.callTool({ name: "codex_tool_call", arguments: {
      turn_token: token, wire_name: "Read", arguments: { path: "sibling.ts" },
    } });
    const batch = await broker.nextToolBatch(token);
    expect(batch).toHaveLength(1);
    expect(batch[0]?.arguments).toEqual({ path: "sibling.ts" });
    await broker.completeTool(token, batch[0]!.callId, { content: [{ type: "text", text: "sibling result" }] });
    expect((await b).isError).toBeFalsy();
  } finally {
    log.mockRestore();
    try { await client.close(); }
    finally { await broker.close(); rmSync(root, { recursive: true, force: true }); }
  }
}, 15_000);

test("external Responses agent can inventory and execute through the unchanged native MCP stdio connector", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-agent-mcp-"));
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  const tool = {
    name: "Read", description: "Read a source file in the originating coding agent",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  };
  const declared = [tool,
    { name: "Skill", description: "Agent advertised skill loader", parameters: {
      type: "object", properties: { name: { type: "string" } }, required: ["name"], additionalProperties: false,
    } },
    { name: "ToolSearch", description: "Agent deferred tool registry", parameters: {
      type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false,
    } },
    { name: "mcp__repo__lookup", description: "Agent plugin/MCP tool", parameters: {
      type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false,
    } },
  ];
  const token = await broker.register({ kind: "external-agent", tools: declared }, 60_000);
  const client = new Client({ name: "agent-responses-external-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath],
    cwd: process.cwd(), stderr: "pipe",
  });
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  try {
    await client.connect(transport);
    const discovered = await call("codex_tool_inventory", { turn_token: token, include_schema: true });
    expect(discovered.isError).toBeFalsy();
    expect(discovered.structuredContent).toMatchObject({ total: 4 });
    const catalog = discovered.structuredContent as { tools: Array<{ wire_name: string; parameters: unknown }> };
    expect(catalog.tools.map(item => item.wire_name)).toEqual(declared.map(item => item.name));
    expect(catalog.tools[0]?.parameters).toEqual(tool.parameters);
    for (const [name, params] of [
      ["codex_exec", { cmd: "must-not-run" }],
      ["codex_apply_patch", { patch: "*** Begin Patch\n*** End Patch" }],
      ["codex_view_image", { path: "secret.png" }],
    ] as const) {
      const denied = await call(name, { turn_token: token, ...params });
      expect(denied.isError).toBe(true);
      expect(JSON.stringify(denied.content)).toContain("native Codex shortcuts are unavailable");
    }
    const invalid = await call("codex_tool_call", { turn_token: token,
      wire_name: "Read", arguments: { path: 42 } });
    expect(invalid.isError).toBe(true);
    expect(JSON.stringify(invalid.content)).toContain("violate its advertised JSON Schema");

    // The model's request is queued for the originating coding agent; no shell or file access
    // exists in the provider. Only a simulated agent result can settle this call.
    const invoked = call("codex_tool_call", { turn_token: token,
      wire_name: "Read", arguments: { path: "agent-project/index.ts" } });
    const batch = await broker.nextToolBatch(token);
    expect(batch).toHaveLength(1);
    expect(batch[0]).toMatchObject({ wireName: "Read", arguments: { path: "agent-project/index.ts" } });
    await broker.completeTool(token, batch[0]!.callId, { content: [{ type: "text", text: "export const ready = true" }] });
    const completed = await invoked;
    expect(completed.isError).toBeFalsy();
    expect(JSON.stringify(completed.content)).toContain("export const ready = true");

    const screenshot = call("codex_tool_call", { turn_token: token,
      wire_name: "Read", arguments: { path: "screenshot.png" } });
    const next = await broker.nextToolBatch(token);
    expect(next).toHaveLength(1);
    await broker.completeTool(token, next[0]!.callId, {
      content: [{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
      structuredContent: { mimeType: "image/png" },
    });
    const multimodal = await screenshot;
    expect(multimodal.isError).toBeFalsy();
    expect(multimodal.content).toEqual([{ type: "image", data: "aGVsbG8=", mimeType: "image/png" }]);
    expect(multimodal.structuredContent).toEqual({ mimeType: "image/png" });

    // Skills/deferred search/MCP plugins work only when the originating agent explicitly
    // advertises each one as a normal callable function. This cannot run hidden CLI hooks.
    const operations = [
      { name: "Skill", args: { name: "code-anime" }, answer: "Loaded skill instructions" },
      { name: "ToolSearch", args: { query: "repo tool" }, answer: "Found mcp__repo__lookup" },
      { name: "mcp__repo__lookup", args: { path: "repo.ts" }, answer: "Agent-owned plugin result" },
    ];
    for (const operation of operations) {
      const pending = call("codex_tool_call", { turn_token: token,
        wire_name: operation.name, arguments: operation.args });
      const batch = await broker.nextToolBatch(token);
      expect(batch).toMatchObject([{ wireName: operation.name, arguments: operation.args }]);
      await broker.completeTool(token, batch[0]!.callId,
        { content: [{ type: "text", text: operation.answer }] });
      expect(JSON.stringify((await pending).content)).toContain(operation.answer);
    }
    const forged = await call("codex_tool_call", { turn_token: token,
      wire_name: "mcp__unadvertised__delete_files", arguments: { path: "repo.ts" } });
    expect(forged.isError).toBe(true);
  } finally {
    await client.close();
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);

test("scaled environment TTL retires MCP before owner expiry and rejects late full-batch continuation", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-agent-mcp-expiry-"));
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  const client = new Client({ name: "agent-expiry-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath],
    cwd: process.cwd(), stderr: "pipe",
  });
  const model = "chatgpt-web/gpt-5.6-luna";
  const tools = [{ type: "function", name: "Read", parameters: {
    type: "object", properties: { path: { type: "string" } }, required: ["path"],
  } }];
  const request = (input: unknown) => parseAgentResponsesRequest({ model, tools, input });
  let browserRuns = 0;
  let result!: ReturnType<Client["callTool"]>;
  let finishBrowser!: () => void;
  const holdBrowser = new Promise<void>(resolve => { finishBrowser = resolve; });
  // Scale the environment TTL only; the MCP handler and its release path remain real.
  const boundedBroker = new Proxy(broker, {
    get(target, key) {
      if (key === "register") return (environment: Parameters<TurnBroker["register"]>[0],
        _ttl?: number, traceId?: string, externalOwner?: boolean) =>
        target.register(environment, 2_000, traceId, externalOwner);
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manager = new AgentResponsesSessionManager(boundedBroker, providerConfig(defaultConfig("full")), {
    async run(turn) {
      browserRuns++;
      const token = (await turn.prepare()).turnToken!;
      result = client.callTool({ name: "codex_tool_call", arguments: {
        turn_token: token, wire_name: "Read", arguments: { path: "slow.ts" },
      } });
      const progress = turn.externalProgress!;
      while (progress.snapshot().lastToolBatchRevision === 0) {
        await progress.waitForChange(progress.snapshot().revision);
      }
      await progress.acknowledgeToolBatch(progress.snapshot().lastToolBatchRevision);
      await holdBrowser;
      await result;
      return "";
    },
  }, 60_000);
  try {
    await client.connect(transport);
    const stage = await manager.start(request("Read slow.ts"), {
      backendModel: "gpt-5.6-luna", adapterEffort: "low",
    });
    expect(stage.calls).toHaveLength(1);
    const timeout = await result;
    expect(timeout.isError).toBe(true);
    expect(timeout.structuredContent).toMatchObject({ code: "codex_tool_timeout", retryable: false });
    expect(manager.activeCount()).toBe(1);
    const continuation = request([{ role: "user", content: "Read slow.ts" }, {
      type: "function_call_output", call_id: stage.calls[0]!.callId, output: "late result",
    }]);
    await expect(manager.continue(continuation)).rejects.toMatchObject({ status: 409 });
    expect(manager.activeCount()).toBe(0);
    expect(manager.hasPendingCall(stage.calls[0]!.callId)).toBe(false);
    await expect(manager.continue(continuation)).rejects.toMatchObject({ status: 409 });
    expect(browserRuns).toBe(1);
  } finally {
    finishBrowser();
    manager.closeAll();
    try { await client.close(); }
    finally {
      await broker.close();
      rmSync(root, { recursive: true, force: true });
    }
  }
}, 15_000);
