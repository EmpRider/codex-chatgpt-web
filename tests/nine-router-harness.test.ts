import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { defaultConfig, providerConfig } from "../src/config";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { NineRouterSessionManager } from "../src/integrations/nine-router/session-manager";
import { NineRouterProvider } from "../src/integrations/nine-router/routes";

test("synthetic read/edit/test cycle traverses real stdio MCP, broker and one 9Router browser turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-r9-simulation-"));
  const broker = TurnBroker.forSocket(join(root, "broker.sock"));
  const client = new Client({ name: "9router-simulated-coding-agent", version: "1.0.0" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath], cwd: process.cwd(), stderr: "pipe" });
  const names = ["Read", "Edit", "Bash"] as const;
  const parameters = { type: "object", properties: { command: { type: "string" } },
    required: ["command"], additionalProperties: false };
  const tools = names.map(name => ({ type: "function", name,
    description: `Simulated originating-agent ${name}`, parameters }));
  const agentReplies = ["source content", "patch applied", "tests passed"];
  const seen: Array<{ name: string; reply: string }> = [];
  let browserRuns = 0;
  let prepared = 0;
  let previousBatchRevision = 0;
  const config = defaultConfig("full");
  config.solAvailable = false;
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    async run(turn) {
      browserRuns++;
      const token = (await turn.prepare()).turnToken!;
      prepared++;
      for (const name of names) {
        const invocation = client.callTool({ name: "codex_tool_call", arguments: {
          turn_token: token, wire_name: name, arguments: { command: `${name} simulated` },
        } });
        const progress = turn.externalProgress!;
        let revision = progress.snapshot().lastToolBatchRevision;
        while (revision <= previousBatchRevision) {
          await progress.waitForChange(progress.snapshot().revision);
          revision = progress.snapshot().lastToolBatchRevision;
        }
        await progress.acknowledgeToolBatch(revision);
        previousBatchRevision = revision;
        const result = await invocation;
        expect(result.isError).toBeFalsy();
        const blocks = result.content as Array<{ type: string; text: string }>;
        const reply = blocks[0]!.text;
        seen.push({ name, reply });
        turn.onTextDelta(`${name}: ${reply}\n`);
      }
      return "Read/edit/test completed";
    },
  });
  const key = "integration-test_" + "v".repeat(45);
  const provider = new NineRouterProvider(config, broker, key, manager);
  const route = "/integrations/9router/v1/responses";
  const input: Array<Record<string, unknown>> = [{ role: "user", content: "Read, edit and test a file" }];
  const send = async () => {
    const response = await provider.handle(new Request(`http://127.0.0.1${route}`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ model: "chatgpt-web/gpt-5.6-luna", stream: false, tools, input }),
    }), route);
    expect(response.status).toBe(200);
    return response.json() as Promise<{ output: Array<{ type: string; call_id?: string; name?: string;
      arguments?: string; content?: Array<{ text: string }> }> }>;
  };
  try {
    await client.connect(transport);
    const inventory = await client.callTool({ name: "codex_tool_inventory", arguments: {
      turn_token: "invalid_unclaimed", include_schema: true,
    } });
    expect(inventory.isError).toBe(true);
    for (const [index, name] of names.entries()) {
      const response = await send();
      const call = response.output.find(entry => entry.type === "function_call");
      expect(call).toMatchObject({ name });
      expect(JSON.parse(call!.arguments!)).toEqual({ command: `${name} simulated` });
      input.push({ type: "function_call", call_id: call!.call_id, name, arguments: call!.arguments });
      input.push({ type: "function_call_output", call_id: call!.call_id, output: agentReplies[index] });
    }
    const final = await send();
    expect(final.output.find(entry => entry.type === "message")?.content?.[0]?.text).toContain("Bash: tests passed");
    expect(seen).toEqual(names.map((name, index) => ({ name, reply: agentReplies[index] })));
    expect(browserRuns).toBe(1);
    expect(prepared).toBe(1);
    expect(manager.activeCount()).toBe(0);
    // No process in this fixture performs actual file or shell mutations.
  } finally {
    provider.close();
    await client.close();
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 25_000);
