import { expect, test } from "bun:test";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { ChatGptExternalTurnProgress } from "../src/adapters/chatgpt-web/turn-progress";

function runtime(timeoutMs: number) {
  let reject!: (error: Error) => void;
  const browser = new Promise<string>((_r, fail) => { reject = fail; });
  return {
    mode: "tools" as const, token: Promise.resolve("t"), browser,
    physicalSettlement: browser.then(() => {}, () => {}),
    trace: new ChatGptTraceFeed(), text: new ChatGptTextFeed(),
    externalProgress: new ChatGptExternalTurnProgress(), toolResultTimeoutMs: timeoutMs,
    cancel: (error?: Error) => reject(error ?? new Error("cancelled")),
  };
}

test("a watchdog-killed session is recoverable and retiring it lets the key start a fresh turn", async () => {
  const sessions = new ChatGptTurnSessions();
  const first = sessions.getOrCreate("k", () => runtime(20), "trace1");
  first.setOutstanding([{ callId: "c1", wireName: "exec_command", freeform: false }]);
  expect(sessions.toolResultTimeoutSession("k")).toBeUndefined(); // still running
  await first.browserOutcome;
  expect(sessions.toolResultTimeoutSession("k")).toBe(first);
  await sessions.retireAndWait("k");
  expect(sessions.toolResultTimeoutSession("k")).toBeUndefined();
  const second = sessions.getOrCreate("k", () => runtime(20), "trace2");
  expect(second).not.toBe(first);
  expect(second.isActive()).toBeTrue();
  second.cancel(new Error("cleanup")); await second.browserOutcome;
});

test("an ordinary browser failure is not treated as a tool timeout", async () => {
  const sessions = new ChatGptTurnSessions();
  const s = sessions.getOrCreate("j", () => runtime(60_000), "trace3");
  s.cancel(new Error("boom")); await s.browserOutcome;
  expect(sessions.toolResultTimeoutSession("j")).toBeUndefined();
});
