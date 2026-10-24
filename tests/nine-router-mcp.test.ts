import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

test("external 9Router agent can inventory and execute through the unchanged native MCP stdio connector", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-r9-mcp-"));
  const broker = TurnBroker.forSocket(join(root, "broker.sock"));
  const tool = {
    name: "Read", description: "Read a source file in the originating coding agent",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"], additionalProperties: false },
  };
  const token = await broker.register({ kind: "external-agent", tools: [tool] }, 60_000);
  const client = new Client({ name: "9router-external-agent-test", version: "1.0.0" });
  const transport = new StdioClientTransport({
    command: process.execPath, args: ["src/cli.ts", "mcp", "--broker-socket", broker.socketPath],
    cwd: process.cwd(), stderr: "pipe",
  });
  const call = (name: string, args: Record<string, unknown>) => client.callTool({ name, arguments: args });
  try {
    await client.connect(transport);
    const discovered = await call("codex_tool_inventory", { turn_token: token, include_schema: true });
    expect(discovered.isError).toBeFalsy();
    expect(discovered.structuredContent).toMatchObject({
      total: 1, tools: [{ wire_name: "Read", name: "Read", parameters: tool.parameters }],
    });
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
  } finally {
    await client.close();
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
