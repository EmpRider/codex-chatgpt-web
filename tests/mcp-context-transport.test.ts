import { afterAll, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS,
  CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD,
  CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
  createChatGptWebMcpContextTransport,
} from "../src/adapters/chatgpt-web/context-transport";
import type { ChatGptTurnEnvironment } from "../src/adapters/chatgpt-web/environment";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { compileChatGptWebPrompt } from "../src/adapters/chatgpt-web/prompt";
import {
  callTurnBroker,
  RemoteTurnBroker,
  TurnBroker,
} from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import type { CodexParsedRequest } from "../src/types";

const testRoot = mkdtempSync(join(tmpdir(), "cgw-mcp-context-"));
afterAll(() => rmSync(testRoot, { recursive: true, force: true }));

function brokerEndpoint(name: string): string {
  return process.platform === "win32"
    ? defaultBrokerEndpoint(join(testRoot, name), "win32")
    : join(tmpdir(), `cgw-mcp-${process.pid}-${name}.sock`);
}

function environment(): ChatGptTurnEnvironment {
  return {
    cwd: testRoot,
    roots: [testRoot],
    writableRoots: [testRoot],
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

test("large Full-mode context leaves the visible composer and becomes an exact MCP payload", () => {
  const token = "turn_12345678901234567890123456789012";
  const sentinel = `LARGE-CONTEXT-SENTINEL-${"x".repeat(CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD + 4096)}`;
  const compiled = compileChatGptWebPrompt(
    parsedRequest(sentinel),
    { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
    token,
  );

  expect(compiled.contextTransport).toBeDefined();
  expect(compiled.contextTransport!.text).toContain(sentinel);
  expect(compiled.contextTransport!.chars).toBe(compiled.contextTransport!.text.length);
  expect(compiled.contextTransport!.bytes).toBe(Buffer.byteLength(compiled.contextTransport!.text, "utf8"));
  expect(compiled.contextTransport!.chunkChars).toBe(CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS);
  expect(compiled.contextTransport!.contextId).toMatch(/^ctx_[a-f0-9]{32}$/);
  expect(compiled.contextTransport!.sha256).toMatch(/^[a-f0-9]{64}$/);
  expect(compiled.text).not.toContain(sentinel);
  expect(compiled.text.length).toBeLessThan(10_000);
  expect(compiled.text).toContain(CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME);
  expect(compiled.text).toContain(compiled.contextTransport!.contextId);
  expect(compiled.text).toContain(compiled.contextTransport!.sha256);
  expect(compiled.text).toContain(`turn_token ${token}`);
  expect(compiled.text).toContain("codex_tool_inventory");
  expect(compiled.text).toContain("codex_tool_call");
  expect(compiled.text).toContain("before executing the task");
});

test("small Full-mode context keeps the proven inline transport", () => {
  const token = "turn_12345678901234567890123456789012";
  const compiled = compileChatGptWebPrompt(
    parsedRequest("small-task-sentinel"),
    { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
    token,
  );

  expect(compiled.contextTransport).toBeUndefined();
  expect(compiled.text).toContain("<codex_context_json>");
  expect(compiled.text).toContain("small-task-sentinel");
});


test("a large final Full-mode browser prompt uses MCP even when its canonical context is below the old threshold", () => {
  const token = "turn_12345678901234567890123456789012";
  let compiled: ReturnType<typeof compileChatGptWebPrompt> | undefined;

  // Find a normal typed user message whose canonical context is still below the historical
  // 32,768-character cutoff but whose complete JSON-encoded browser prompt crosses that budget.
  // This proves transport selection is based on what would actually be submitted to ChatGPT.
  for (let userChars = 20_000; userChars < CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD; userChars += 512) {
    const candidate = compileChatGptWebPrompt(
      parsedRequest(`ordinary-typed-user-message-${"x".repeat(userChars)}`),
      { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
      token,
    );
    if (
      candidate.contextTransport
      && candidate.contextTransport.chars < CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD
    ) {
      compiled = candidate;
      break;
    }
  }

  expect(compiled).toBeDefined();
  expect(compiled!.contextTransport).toBeDefined();
  expect(compiled!.contextTransport!.chars).toBeLessThan(CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD);
  expect(compiled!.contextTransport!.text).toContain("ordinary-typed-user-message-");
  expect(compiled!.text).not.toContain("<codex_context_json>");
  expect(compiled!.text).not.toContain("ordinary-typed-user-message-");
  expect(compiled!.text).toContain(CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME);
  expect(compiled!.text).toContain("codex_tool_inventory");
});

test("broker context chunks reconstruct exactly and become immutable after MCP binding", async () => {
  const socketPath = brokerEndpoint("context");
  const broker = TurnBroker.forSocket(socketPath);
  const text = `prefix-${"αβγ-code-json-".repeat(8_000)}-suffix`;
  const context = createChatGptWebMcpContextTransport(text);
  try {
    const token = await broker.register(environment(), 60_000, "context-roundtrip");
    await broker.setContextTransport(token, context);
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token });

    const chunks: string[] = [];
    let chunk = 0;
    for (;;) {
      const response = await callTurnBroker<{
        context_id: string;
        sha256: string;
        chars: number;
        bytes: number;
        chunk: number;
        total_chunks: number;
        text: string;
        next_chunk: number | null;
      }>(socketPath, {
        method: "context_read",
        bindingId: claimed.bindingId,
        contextId: context.contextId,
        chunk,
      });
      expect(response.context_id).toBe(context.contextId);
      expect(response.sha256).toBe(context.sha256);
      expect(response.chars).toBe(context.chars);
      expect(response.bytes).toBe(context.bytes);
      expect(response.chunk).toBe(chunk);
      chunks.push(response.text);
      if (response.next_chunk === null) break;
      chunk = response.next_chunk;
    }
    expect(chunks.join("")).toBe(text);

    await expect(broker.setContextTransport(token, createChatGptWebMcpContextTransport("replacement")))
      .rejects.toThrow("already bound");
    await expect(callTurnBroker(socketPath, {
      method: "context_read",
      bindingId: claimed.bindingId,
      contextId: `${context.contextId}bad`,
      chunk: 0,
    })).rejects.toThrow("context id");
    await expect(callTurnBroker(socketPath, {
      method: "context_read",
      bindingId: claimed.bindingId,
      contextId: context.contextId,
      chunk: 999_999,
    })).rejects.toThrow("chunk");

    broker.revoke(token);
    await expect(callTurnBroker(socketPath, {
      method: "context_read",
      bindingId: claimed.bindingId,
      contextId: context.contextId,
      chunk: 0,
    })).rejects.toThrow("already finished");
  } finally {
    await broker.close();
  }
});

test("RemoteTurnBroker installs context into the live owner protocol", async () => {
  const socketPath = brokerEndpoint("remote");
  const broker = TurnBroker.forSocket(socketPath);
  const remote = new RemoteTurnBroker(socketPath);
  try {
    await broker.listen();
    await remote.assertCompatible();
    const token = await remote.register(environment(), 60_000, "remote-context");
    const context = createChatGptWebMcpContextTransport("remote-context-payload");
    await remote.setContextTransport(token, context);
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token });
    const result = await callTurnBroker<{ text: string }>(socketPath, {
      method: "context_read",
      bindingId: claimed.bindingId,
      contextId: context.contextId,
      chunk: 0,
    });
    expect(result.text).toBe("remote-context-payload");
  } finally {
    await broker.close();
  }
});

test("native MCP exposes the reserved reader through existing inventory/call tools only", async () => {
  const socketPath = brokerEndpoint("stdio");
  const broker = TurnBroker.forSocket(socketPath);
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: ["src/cli.ts", "mcp", "--broker-socket", socketPath],
    cwd: process.cwd(),
    stderr: "pipe",
  });
  const client = new Client({ name: "codex-context-transport-test", version: "1.0.0" });
  let token: string | undefined;
  try {
    token = await broker.register(environment(), 60_000, "stdio-context");
    const context = createChatGptWebMcpContextTransport(`mcp-${"payload-".repeat(10_000)}`);
    await broker.setContextTransport(token, context);
    await client.connect(transport);

    const publicTools = await client.listTools();
    expect(publicTools.tools.map(tool => tool.name)).not.toContain(CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME);
    expect(publicTools.tools.map(tool => tool.name)).toContain("codex_tool_inventory");
    expect(publicTools.tools.map(tool => tool.name)).toContain("codex_tool_call");

    const inventory = await client.callTool({
      name: "codex_tool_inventory",
      arguments: {
        turn_token: token,
        query: CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
      },
    });
    expect(inventory.isError).not.toBe(true);
    expect(inventory.structuredContent).toMatchObject({
      total: 1,
      tools: [{
        wire_name: CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
        kind: "bridge",
      }],
    });

    const read = await client.callTool({
      name: "codex_tool_call",
      arguments: {
        turn_token: token,
        wire_name: CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
        arguments: { context_id: context.contextId, chunk: 0 },
      },
    });
    expect(read.isError).not.toBe(true);
    expect(read.structuredContent).toMatchObject({
      context_id: context.contextId,
      chunk: 0,
      text: context.text.slice(0, CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS),
    });

    const pendingOuterTool = broker.nextToolBatch(token);
    expect(await Promise.race([
      pendingOuterTool.then(() => "unexpected_outer_tool"),
      Bun.sleep(25).then(() => "none"),
    ])).toBe("none");
  } finally {
    if (token) broker.revoke(token);
    await client.close().catch(() => {});
    await broker.close();
  }
}, 30_000);

test("large compaction reads complete history over MCP before summarizing", () => {
  const sentinel = "COMPACTION-HISTORY-".repeat(12_000);
  const parsed = parsedRequest(sentinel);
  parsed._compactionRequest = true;
  const compiled = compileChatGptWebPrompt(parsed,
    { localToolsEnabled: true, solAvailable: true, extraHighAvailable: true, proAvailable: true },
    "turn_12345678901234567890123456789012");
  expect(compiled.contextTransport?.text).toContain(sentinel);
  expect(compiled.text).not.toContain(sentinel);
  expect(compiled.trimmedCompactionMessages).toBeUndefined();
  expect(compiled.text).toContain("codex_tool_inventory");
  expect(compiled.text).toContain("Produce the requested checkpoint summary");
  expect(compiled.text).not.toContain("Execute the latest active user request");
  expect(compiled.text).not.toContain("Do not call local or ChatGPT-native tools");
});
