import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";

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
