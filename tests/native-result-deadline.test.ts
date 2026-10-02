import { expect, test } from "bun:test";
import { ChatGptTurnSession, ChatGptTextFeed, ChatGptTraceFeed } from "../src/adapters/chatgpt-web/turn-execution";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";

// Regression: after emission, a missing native result keeps activeToolCalls nonzero
// indefinitely. DOM completion and ordinary heartbeats cannot retire that lost round.
test("a missing native tool result cancels its session with an unknown-outcome error", async () => {
  let reject!: (error: Error) => void;
  const browser = new Promise<string>((_resolve, fail) => { reject = fail; });
  const runtime = {
    mode: "tools" as const, token: Promise.resolve("turn_deadline"), browser,
    physicalSettlement: browser.then(() => {}, () => {}), trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(),
    externalProgress: new ChatGptExternalTurnProgress(), cancel: (error?: Error) => reject(error ?? new Error("cancelled")),
    toolResultTimeoutMs: 20,
  };
  const session = new ChatGptTurnSession(runtime);
  session.setOutstanding([{ callId: "call_read", wireName: "exec_command", freeform: false, arguments: { cmd: "read file" } }]);
  try {
    const outcome = await Promise.race([session.browserOutcome, Bun.sleep(150).then(() => ({ type: "still waiting" }))]);
    expect(outcome).toMatchObject({ type: "error", error: { code: "codex_tool_result_timeout", retryable: false } });
    expect((outcome as { error: Error }).error.message).toContain("outcome is unknown");
  } finally { session.cancel(new Error("cleanup")); await session.browserOutcome; }
});

test("returning every result clears the native batch deadline", async () => {
  let rejected = false;
  const session = new ChatGptTurnSession({
    mode: "tools", token: Promise.resolve("turn_returned"), browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(), trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(),
    externalProgress: new ChatGptExternalTurnProgress(), toolResultTimeoutMs: 20,
    cancel() { rejected = true; },
  });
  session.setOutstanding([{ callId: "call_read", wireName: "exec_command", freeform: false }]);
  session.markResultDelivered("call_read");
  await Bun.sleep(50);
  expect(rejected).toBeFalse();
  expect(session.outstanding()).toEqual([]);
});
