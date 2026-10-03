import { expect, test } from "bun:test";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";

function fixture(label: string, url = "https://chatgpt.com/c/test") {
  const controls: any = {
    filter: () => controls, first: () => controls, count: async () => 1,
    innerText: async () => label, getAttribute: async () => "false",
  };
  const composer: any = { locator: () => ({ locator: () => controls }), isEditable: async () => true };
  const worker: any = Object.create(ChatGptBrowserWorker.prototype);
  worker.activeComposer = async () => composer;
  const page: any = { url: () => url };
  return { worker, page };
}

test("fresh explicit family label avoids reopening the picker immediately before Send", async () => {
  const { worker, page } = fixture("5.6 Sol Extra High");
  await expect(worker.assertSelectedEffort(page, {
    modelFamily: "5.6", effort: "xhigh", uiEffortIndex: 3,
    selection: { url: page.url(), label: "5.6 Sol Extra High" },
  })).resolves.toBeUndefined();
});

test("changed closed effort label still blocks submission", async () => {
  const { worker, page } = fixture("5.6 Sol High");
  await expect(worker.assertSelectedEffort(page, {
    modelFamily: "5.6", effort: "xhigh", uiEffortIndex: 3,
    selection: { url: page.url(), label: "5.6 Sol Extra High" },
  })).rejects.toMatchObject({ retryable: false });
});

test("ambiguous Pro label cannot bypass fresh family verification", async () => {
  const { worker, page } = fixture("Pro");
  // This fixture deliberately has no menu: ambiguous evidence must not succeed through the fast path.
  await expect(worker.assertSelectedEffort(page, {
    modelFamily: "6", effort: "max", uiEffortIndex: 4,
    selection: { url: page.url(), label: "Pro" },
  })).rejects.toThrow();
});

test("a same-family effort rollback at menu close cannot pass the fast path", async () => {
  const { worker, page } = fixture("5.6 Sol High");
  await expect(worker.assertSelectedEffort(page, {
    modelFamily: "5.6", effort: "xhigh", uiEffortIndex: 3,
    selection: { url: page.url(), label: "5.6 Sol High" },
  })).rejects.toThrow();
});
