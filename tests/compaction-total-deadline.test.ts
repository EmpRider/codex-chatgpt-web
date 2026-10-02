import { expect, test } from "bun:test";
import { requestRetainedCompactionHandoff } from "../src/adapters/chatgpt-web/compaction-handoff";
import type { BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import type { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { ChatGptTurnSession, ChatGptTextFeed, ChatGptTraceFeed } from "../src/adapters/chatgpt-web/turn-execution";
import type { CodexParsedRequest } from "../src/types";
import { createChatGptWebAdapter, chatGptWebExecutionNamespace } from "../src/adapters/chatgpt-web/index";
import { chatGptConversationKey } from "../src/adapters/chatgpt-web/conversation-key";
import { chatGptTurnSessions, chatGptTurnExecutionKey } from "../src/adapters/chatgpt-web/turn-execution";
import { TurnBroker as LocalTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import type { AdapterEvent, CodexProviderConfig } from "../src/types";

// Regression: process heartbeats continuously renew the compaction inactivity timer,
// so a browser that never submits its checkpoint can wait for hours.
test("compaction heartbeats cannot extend the total checkpoint deadline", async () => {
  const parsed = { modelId: "gpt-5.6-sol", stream: true, options: {}, context: { messages: [{ role: "user", content: "Read file", timestamp: 1 }] } } as CodexParsedRequest;
  const source = new ChatGptTurnSession({
    mode: "read-only", browser: Promise.resolve("source"), physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(), conversationKey: "deadline-conversation", cancel() {},
  });
  let aborted = false;
  let revoked = false;
  const broker = {
    beginCompactionTransaction: async () => ({ token: "control_11111111111111111111111111111111", handoffId: "handoff_22222222222222222222222222222222" }),
    renewCompactionTransaction() {},
    waitForCompactionHandoff: () => new Promise<string>(() => {}),
    abortCompactionTransaction() { revoked = true; },
  } as unknown as TurnBroker;
  const worker = { run: async (turn: BrowserTurn) => {
    const heartbeat = setInterval(() => turn.onHeartbeat?.(), 5);
    try {
      return await new Promise<string>((_resolve, reject) => {
        const abort = () => { aborted = true; reject(new DOMException("cancelled", "AbortError")); };
        if (turn.abortSignal?.aborted) abort();
        else turn.abortSignal?.addEventListener("abort", abort, { once: true });
      });
    } finally { clearInterval(heartbeat); }
  } };
  const cancel = new AbortController();
  const run = requestRetainedCompactionHandoff(worker as never, parsed, source, broker,
    { localToolsEnabled: true, solAvailable: true, proAvailable: true, extraHighAvailable: true }, "deadline", cancel.signal, 40);
  try {
    const outcome = await Promise.race([run.catch(error => error), Bun.sleep(1_000).then(() => "still waiting")]);
    expect(outcome).toBeInstanceOf(Error);
    expect((outcome as Error).message).toContain("total checkpoint deadline");
    expect(aborted).toBeTrue();
    expect(revoked).toBeTrue();
  } finally { cancel.abort(); await run.catch(() => {}); }
});

test("a compaction deadline returns while physical source cleanup remains owned", async () => {
  const provider: CodexProviderConfig = {
    adapter: "chatgpt-web", baseUrl: `browser://cleanup-deadline-${Date.now()}`,
    chatgptWeb: { browserHost: "launcher", browserHostDescriptorPath: "/unused/launcher.json", localToolsEnabled: true, turnTimeoutMs: 30 },
  };
  const sourceRequest: CodexParsedRequest = {
    modelId: "gpt-5.6-sol", stream: true, options: {}, context: { messages: [{ role: "user", content: "Read file", timestamp: 1 }] },
    _rawBody: { input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "Read file" }], internal_chat_message_metadata_passthrough: { turn_id: "source-turn" } }], client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "cleanup-thread", turn_id: "source-turn" }) } },
  };
  const namespace = chatGptWebExecutionNamespace(provider);
  let failBrowser!: (error: Error) => void;
  let releasePhysical!: () => void;
  const physical = new Promise<void>(resolve => { releasePhysical = resolve; });
  const key = `${namespace}:${chatGptTurnExecutionKey(sourceRequest)}`;
  const source = chatGptTurnSessions.getOrCreate(key, () => ({
    mode: "read-only", browser: new Promise<string>((_resolve, reject) => { failBrowser = reject; }),
    physicalSettlement: physical, trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(),
    usageInput: sourceRequest, conversationKey: chatGptConversationKey(sourceRequest, namespace)!,
    cancel: () => failBrowser(new Error("source cancelled")),
  }));
  const compact = structuredClone(sourceRequest);
  compact._compactionRequest = true;
  (compact._rawBody as any).client_metadata["x-codex-turn-metadata"] = JSON.stringify({ thread_id: "cleanup-thread", turn_id: "compact-turn" });
  const events: AdapterEvent[] = [];
  // No broker I/O is reached: the source never produces its terminal answer.
  const broker = LocalTurnBroker.forSocket(`/tmp/cleanup-deadline-${Date.now()}.sock`);
  const run = createChatGptWebAdapter(provider, { broker }).runTurn!(compact, { headers: new Headers() }, event => events.push(event));
  try {
    expect(await Promise.race([run.then(() => "settled"), Bun.sleep(1_000).then(() => "still waiting")])).toBe("settled");
    expect(events.at(-1)).toMatchObject({ type: "error", code: "compaction_handoff_timeout", retryable: false });
    expect(source.isPhysicallySettled()).toBeFalse();
  } finally { releasePhysical(); await run.catch(() => {}); chatGptTurnSessions.clear(); await broker.close(); }
});
