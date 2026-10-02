import { expect, test } from "bun:test";
import { ChatGptBrowserWorker, type BrowserTurn } from "../src/adapters/chatgpt-web/browser-worker";
import { createChatGptWebAdapter } from "../src/adapters/chatgpt-web/index";
import { CHATGPT_WEB_MODEL_ID } from "../src/adapters/chatgpt-web/model";
import type { TurnBrokerOwner } from "../src/adapters/chatgpt-web/turn-broker";
import { chatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import type { AdapterEvent, CodexParsedRequest, CodexProviderConfig } from "../src/types";

// Regression: a missing helper acknowledgement holds a pulled tool batch forever,
// while repeated browser heartbeats make the accepted turn appear healthy.
for (const acknowledge of [false, true]) {
test(`${acknowledge ? "an acknowledged boundary dispatches its command" : "an unacknowledged native tool boundary fails without dispatching the command"}`, async () => {
  const provider: CodexProviderConfig = {
    adapter: "chatgpt-web", baseUrl: `browser://boundary-deadline-${Date.now()}`,
    chatgptWeb: { localToolsEnabled: true, turnTimeoutMs: 40 },
  };
  const parsed: CodexParsedRequest = {
    modelId: CHATGPT_WEB_MODEL_ID, stream: true, options: {},
    context: {
      tools: [{ name: "exec_command", description: "Run command", parameters: { type: "object" } }],
      messages: [{ role: "user", content: "Read the attached text file", timestamp: 1 }],
    },
    _rawBody: {
      prompt_cache_key: "boundary-thread",
      client_metadata: { "x-codex-turn-metadata": JSON.stringify({ thread_id: "boundary-thread", turn_id: "boundary-turn" }) },
      input: [{ type: "message", role: "user", internal_chat_message_metadata_passthrough: { turn_id: "boundary-turn" }, content: [{ type: "input_text", text: `<environment_context>\n<cwd>${process.cwd()}</cwd>\n<filesystem><workspace_roots><root>${process.cwd()}</root></workspace_roots><permission_profile type="disabled"><file_system type="unrestricted" /></permission_profile></filesystem>\n</environment_context>` }] }, { type: "message", role: "user", content: [{ type: "input_text", text: "Read the attached text file" }], internal_chat_message_metadata_passthrough: { turn_id: "boundary-turn" } }],
    },
  };
  let revoked = 0;
  let retire!: () => void;
  const retirement = new Promise<void>(resolve => { retire = resolve; });
  const broker = {
    register: async () => "turn_11111111111111111111111111111111",
    updateEnvironment() {},
    waitForRetirement: () => retirement,
    nextToolBatch: async () => [{ callId: "call_read", wireName: "exec_command", freeform: false, arguments: { cmd: "read file" } }],
    revoke() { revoked++; retire(); },
  } as unknown as TurnBrokerOwner;
  const worker = ChatGptBrowserWorker.forProvider(provider);
  const originalRun = worker.run;
  let browserAborted = false;
  worker.run = async (turn: BrowserTurn) => {
    const prepared = await turn.prepare();
    const heartbeat = setInterval(() => turn.onHeartbeat?.(), 5);
    try {
      if (acknowledge) {
        const snapshot = await turn.externalProgress!.waitForChange(0, turn.abortSignal);
        await turn.externalProgress!.acknowledgeToolBatch(snapshot.lastToolBatchRevision);
      }
      return await new Promise<string>((_resolve, reject) => {
        const abort = () => { browserAborted = true; reject(new DOMException("browser cancelled", "AbortError")); };
        if (turn.abortSignal?.aborted) abort();
        else turn.abortSignal?.addEventListener("abort", abort, { once: true });
      });
    } finally { clearInterval(heartbeat); prepared.release(); }
  };
  const observer = new AbortController();
  const events: AdapterEvent[] = [];
  const run = createChatGptWebAdapter(provider, { broker }).runTurn!(parsed, { headers: new Headers(), abortSignal: observer.signal }, e => events.push(e));
  try {
    const outcome = await Promise.race([run.then(() => "settled"), Bun.sleep(1_000).then(() => "still waiting")]);
    expect(outcome).toBe("settled");
    expect(events.some(e => e.type === "tool_call_start")).toBe(acknowledge);
    if (acknowledge) expect(events.find(e => e.type === "error")).toBeUndefined();
    else {
      expect(events.find(e => e.type === "error")).toMatchObject({ code: "browser_tool_boundary_timeout", retryable: false });
      expect(browserAborted).toBeTrue();
      expect(revoked).toBeGreaterThan(0);
    }
  } finally {
    observer.abort();
    await run.catch(() => {});
    chatGptTurnSessions.clear();
    worker.run = originalRun;
  }
});
}
