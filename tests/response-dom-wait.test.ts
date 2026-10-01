import { expect, test } from "bun:test";
import { createContext, runInContext } from "node:vm";
import { readFileSync } from "node:fs";
import { ChatGptBrowserObservationTimeoutError, withChatGptBrowserObservationTimeout } from "../src/adapters/chatgpt-web/browser-worker";
import { waitForChatGptResponseDomChange } from "../src/adapters/chatgpt-web/response-dom-wait";

test("the worker's mutation wakeup bounds a stalled locator with the observation recovery error", async () => {
  // Exercise the actual wait expression used by the worker with a renderer that
  // never starts evaluation, so the page-side 250 ms timer cannot provide a bound.
  const source = readFileSync(new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url), "utf8");
  const call = source.indexOf("responseTurn.locator.evaluate(waitForChatGptResponseDomChange");
  expect(call).toBeGreaterThan(-1);
  const expression = source.slice(source.lastIndexOf("await ", call) + 6, source.indexOf(";\n", call));
  const evaluateWait = new Function("responseTurn", "responseDomCache", "CHATGPT_DOM_REVISION_ATTRIBUTES", "turn", "waitForChatGptResponseDomChange", "withBrowserTurnAbort", "withChatGptBrowserObservationTimeout", `return ${expression}`);
  const pending = evaluateWait(
    { locator: { evaluate: () => new Promise(() => {}) } }, {}, [], {}, waitForChatGptResponseDomChange,
    (operation: Promise<unknown>) => operation,
    (operation: Promise<unknown>) => withChatGptBrowserObservationTimeout(operation, 5),
  );
  const outcome = await Promise.race([
    pending.catch((error: unknown) => error),
    Bun.sleep(50).then(() => "stalled without recovery"),
  ]);
  expect(outcome).toBeInstanceOf(ChatGptBrowserObservationTimeoutError);
});

function fixture() {
  let notify: () => void = () => {};
  let disconnected = 0;
  const state = { id: 1, revision: 1 };
  const root = {};
  const context = createContext({
    setTimeout, clearTimeout,
    __CODEX_WEB_GPT_RESPONSE_OBSERVERS__: { documentId: "doc", states: new WeakMap([[root, state]]) },
    MutationObserver: class {
      constructor(callback: () => void) { notify = callback; }
      observe() {}
      disconnect() { disconnected++; }
    },
  });
  const wait = runInContext(`(${waitForChatGptResponseDomChange.toString()})`, context);
  return { wait, root, state, mutate: () => notify(), disconnected: () => disconnected };
}

test("response mutations wake streaming observation and disconnect the temporary observer", async () => {
  const f = fixture();
  const pending = f.wait(f.root, { knownKey: "doc:1:1", timeoutMs: 250, attributeFilter: ["hidden"] });
  f.state.revision++;
  f.mutate();
  expect(await pending).toBe("changed");
  expect(f.disconnected()).toBe(1);
});

test("changes between snapshot and wait do not wait for another mutation", async () => {
  const f = fixture();
  f.state.revision++;
  expect(await f.wait(f.root, { knownKey: "doc:1:1", timeoutMs: 250, attributeFilter: [] })).toBe("changed");
  expect(f.disconnected()).toBe(1);
});

test("unchanged DOM falls back to bounded polling for CSS and external state", async () => {
  const f = fixture();
  expect(await f.wait(f.root, { knownKey: "doc:1:1", timeoutMs: 1, attributeFilter: [] })).toBe("timeout");
  expect(f.disconnected()).toBe(1);
});

test("streaming mutation bursts are coalesced into one observation", async () => {
  const f = fixture();
  let settled = false;
  const pending = f.wait(f.root, { knownKey: "doc:1:1", timeoutMs: 250, minWaitMs: 10, attributeFilter: [] })
    .then((result: string) => { settled = true; return result; });
  for (let index = 0; index < 20; index++) f.mutate();
  await Promise.resolve();
  expect(settled).toBe(false);
  expect(await pending).toBe("changed");
  expect(f.disconnected()).toBe(1);
});
