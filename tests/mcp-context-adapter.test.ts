import { afterAll, expect, test } from "bun:test";
import { mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChatGptBrowserWorker, type BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS } from "../src/adapters/chatgpt-web/context-transport";
import { createChatGptWebAdapter } from "../src/adapters/chatgpt-web/index";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";
import type { AdapterEvent, CodexParsedRequest, CodexProviderConfig, CodexTool } from "../src/types";

const root = join(tmpdir(), `cgw-mcp-context-adapter-${process.pid}-${Date.now()}`);
mkdirSync(root, { recursive: true });
afterAll(() => rmSync(root, { recursive: true, force: true }));

function brokerEndpoint(): string {
  return process.platform === "win32"
    ? defaultBrokerEndpoint(join(root, "broker"), "win32")
    : join(tmpdir(), `cgw-mcp-adapter-${process.pid}.sock`);
}

function requestWithLargeCurrentUser(sentinel: string): CodexParsedRequest {
  const turnId = "turn_mcp_context_adapter";
  const threadId = "thread_mcp_context_adapter";
  const tools: CodexTool[] = [
    { name: "exec_command", description: "Run command", parameters: { type: "object" } },
  ];
  const environment = `<environment_context>\n  <cwd>${root}</cwd>\n  <filesystem><workspace_roots><root>${root}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>\n</environment_context>`;
  return {
    modelId: CHATGPT_WEB_MODEL_ID,
    stream: true,
    context: {
      tools,
      messages: [{ role: "user", content: sentinel, timestamp: 2 }],
    },
    options: { reasoning: "high" },
    _rawBody: {
      prompt_cache_key: threadId,
      client_metadata: {
        "x-codex-turn-metadata": JSON.stringify({ thread_id: threadId, turn_id: turnId }),
      },
      input: [
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: environment }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
        {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: sentinel }],
          internal_chat_message_metadata_passthrough: { turn_id: turnId },
        },
      ],
    },
  };
}

for (const compaction of [false, true]) {
test(`${compaction ? "Compaction" : "Full"} adapter installs large canonical context before exposing the compact browser bootstrap`, async () => {
  const socketPath = brokerEndpoint();
  const provider: CodexProviderConfig = {
    adapter: "chatgpt-web",
    baseUrl: `browser://mcp-context-adapter-${Date.now()}`,
    chatgptWeb: {
      brokerSocketPath: socketPath,
      ...(compaction ? { browserHost: "launcher" as const, browserHostDescriptorPath: join(root, "launcher.json") } : {}),
      localToolsEnabled: true,
      solAvailable: true,
      proAvailable: true,
    },
  };
  const sentinel = `ADAPTER-CONTEXT-SENTINEL-${"large-user-payload-".repeat(
    Math.ceil((CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS + 8_192) / "large-user-payload-".length),
  )}`;
  const worker = ChatGptBrowserWorker.forProvider(provider);
  const originalRun = worker.run.bind(worker);
  let observedBrowserPrompt = "";

  (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = async turn => {
    const prepared = await turn.prepare();
    observedBrowserPrompt = prepared.text;
    try {
      expect(prepared.contextTransport).toBeDefined();
      expect(prepared.text.length).toBeLessThan(10_000);
      expect(prepared.text).not.toContain(sentinel);
      expect(prepared.text).toContain("codex_web_context_read");

      const token = prepared.text.match(/turn_token (turn_[A-Za-z0-9_-]+)/)?.[1];
      const contextId = prepared.text.match(/context_id: (ctx_[a-f0-9]{32})/)?.[1];
      if (!token || !contextId) throw new Error("compact browser bootstrap is missing its context binding");

      const claimed = await callTurnBroker<{
        environment: { tools: CodexTool[] };
        bindingId: string;
        activityId: string;
        contextTransport?: { contextId: string; sha256: string; chars: number; bytes: number; chunkChars: number };
      }>(socketPath, { method: "claim", token });
      expect(claimed.contextTransport?.contextId).toBe(contextId);
      if (compaction) expect(claimed.environment.tools).toEqual([]);

      const chunks: string[] = [];
      let chunk = 0;
      for (;;) {
        const part = await callTurnBroker<{
          text: string;
          next_chunk: number | null;
        }>(socketPath, {
          method: "context_read",
          bindingId: claimed.bindingId,
          contextId,
          chunk,
        });
        chunks.push(part.text);
        if (part.next_chunk === null) break;
        chunk = part.next_chunk;
      }
      expect(chunks.join("")).toContain(sentinel);
      await callTurnBroker(socketPath, {
        method: "activity_complete",
        token,
        activityId: claimed.activityId,
      });

      const answer = "MCP context transport installed";
      turn.onTextDelta(answer);
      return answer;
    } finally {
      prepared.release();
    }
  };

  try {
    const events: AdapterEvent[] = [];
    await createChatGptWebAdapter(provider).runTurn!(
      { ...requestWithLargeCurrentUser(sentinel), _compactionRequest: compaction },
      { headers: new Headers() },
      event => events.push(event),
    );
    expect(observedBrowserPrompt).not.toContain(sentinel);
    expect(events.at(-1)).toMatchObject({ type: "done", stopReason: "stop", endTurn: true });
  } finally {
    (worker as unknown as { run: (turn: BrowserTurn) => Promise<string> }).run = originalRun;
    await TurnBroker.forSocket(socketPath).close();
  }
}, 30_000);

}
