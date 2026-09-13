import { afterAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS,
  CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
} from "../src/adapters/chatgpt-web/context-transport";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import type { CodexParsedRequest } from "../src/types";

const root = mkdtempSync(join(tmpdir(), "cgw-mcp-context-read-safety-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

function brokerEndpoint(): string {
  return process.platform === "win32"
    ? defaultBrokerEndpoint(join(root, "broker"), "win32")
    : join(tmpdir(), `cgw-mcp-read-${process.pid}.sock`);
}

function environment(): ChatGptTurnEnvironment {
  return {
    cwd: root,
    roots: [root],
    writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" },
    tools: [],
  };
}

function parsedRequest(userContent: string): CodexParsedRequest {
  return {
    modelId: CHATGPT_WEB_MODEL_ID,
    context: {
      systemPrompt: ["preserve-system"],
      messages: [
        { role: "developer", content: "preserve-developer", timestamp: 1 },
        { role: "user", content: userContent, timestamp: 2 },
      ],
    },
    stream: true,
    options: { reasoning: "high" },
  };
}

test("large Full-mode context loads through the read-only inventory channel", async () => {
  const socketPath = brokerEndpoint();
  const broker = TurnBroker.forSocket(socketPath);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", socketPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "codex-context-read-safety-test", version: "1.0.0" });
  let token: string | undefined;

  try {
    token = await broker.register(environment(), 60_000, "context-read-safety");
    const compiled = compileChatGptWebPrompt(
      parsedRequest(`READ-SAFETY-${"x".repeat(CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS + 4096)}`),
      { localToolsEnabled: true, solAvailable: true, proAvailable: true },
      token,
    );
    expect(compiled.contextTransport).toBeDefined();
    await broker.setContextTransport(token, compiled.contextTransport);
    await client.connect(transport);

    const publicTools = await client.listTools();
    expect(publicTools.tools.find(tool => tool.name === "codex_tool_inventory")?.annotations)
      .toMatchObject({ readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false });

    const context = compiled.contextTransport!;
    const reservedQuery = `${CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME}:${context.contextId}`;
    const read = await client.callTool({
      name: "codex_tool_inventory",
      arguments: {
        turn_token: token,
        query: reservedQuery,
        offset: 0,
        limit: 1,
        include_schema: false,
      },
    });

    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toMatchObject({
      context_id: context.contextId,
      sha256: context.sha256,
      chunk: 0,
      total_chunks: 2,
      text: context.text.slice(0, context.chunkChars),
      next_chunk: 1,
    });
    expect(compiled.text).toContain(`query ${JSON.stringify(reservedQuery)}`);
    expect(compiled.text).not.toContain("Then call codex_tool_call with the same turn_token");
  } finally {
    if (token) broker.revoke(token);
    await client.close().catch(() => {});
    await broker.close();
  }
}, 30_000);
