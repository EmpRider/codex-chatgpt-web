import { expect, test } from "bun:test";
import type { Page } from "playwright-core";
import { ChatGptBrowserWorker } from "../src/adapters/chatgpt-web/browser-worker";
import { formatChatGptWebMultipartStage } from "../src/adapters/chatgpt-web/prompt";

const stage = formatChatGptWebMultipartStage(
  JSON.stringify({ context: "x".repeat(180_000) }),
  `ctx_${"e".repeat(32)}`,
  1,
  2,
  "external-agent",
);

type Scenario = {
  header?: string;
  acknowledgement?: string;
  extraTurn?: boolean;
  staleShell?: boolean;
  competingShell?: boolean;
  changeAfterEvidence?: boolean;
  changeAckAfterEvidence?: boolean;
  responseStillStreaming?: boolean;
};

async function rebound(scenario: Scenario = {}) {
  let observations = 0;
  let fullTextChecks = 0;
  let responseReads = 0;
  const replacement = "group:assistant:persisted";
  const old = "group:assistant:optimistic";
  const marker = scenario.header ?? stage.text.slice(0, 1_500);
  const observed = () => ({
    turnIdentities: [
      ...(scenario.staleShell ? ["group:user:optimistic", old] : []),
      "group:user:persisted", replacement,
      ...(scenario.extraTurn || (scenario.changeAfterEvidence && observations > 1)
        ? ["group:user:foreign", "group:assistant:foreign"] : []),
    ],
    userIdentities: ["group:user:persisted", ...(scenario.extraTurn || (scenario.changeAfterEvidence && observations > 1)
      ? ["group:user:foreign"] : [])],
    responseIdentities: [replacement],
    visibleStopButtonCount: 0,
  });
  const page = {
    locator(selector: string) {
      const persisted = selector.includes('persisted');
      const optimistic = selector.includes('optimistic');
      const content = {
        count: async () => persisted ? 1 : 0,
        evaluate: async (fn: (element: { textContent: string }, arg: unknown) => unknown, arg: unknown) => fn({ textContent: marker }, arg),
      };
      return {
        count: async () => persisted ? 1 : optimistic && scenario.staleShell && !selector.includes(":has(") ? 1 : 0,
        locator: (child: string) => child.includes('data-user-message-bubble')
          ? (persisted ? content : { count: async () => scenario.competingShell ? 1 : 0 })
          : { count: async () => 0 },
        evaluate: async (fn: (element: { textContent: string }) => unknown) => fn({ textContent: "" }),
      };
    },
  } as unknown as Page;
  const worker = Object.create(ChatGptBrowserWorker.prototype) as any;
  worker.submissionDomState = async () => { observations += 1; return observed(); };
  worker.reconcileMultipartHistory = async () => {};
  worker.userMessageMatchesSubmission = async () => { fullTextChecks += 1; return false; };
  worker.responseDomSnapshot = async () => {
    responseReads += 1;
    return {
      responsePresent: true,
      completionActionVisible: !scenario.responseStillStreaming,
      visibleText: scenario.changeAckAfterEvidence && responseReads > 1
        ? "CODEX_MULTIPART_ACK altered" : scenario.acknowledgement ?? stage.acknowledgement,
    };
  };
  const baseline = { initialTurnIdentities: [], domCache: {}, submittedText: stage.text };
  const binding = {
    identity: old,
    locator: page.locator('[data-turn-key="optimistic"]:has([data-conversation-role="assistant"])'),
    acceptedTurnIdentities: ["group:user:optimistic", old],
  };
  return { result: worker.reconcileAssistantTurnBinding(page, baseline, binding, undefined, stage), getFullTextChecks: () => fullTextChecks };
}

test("multipart response rebinds after an accepted Send despite a collapsed 180 KB user message", async () => {
  expect(stage.text.length).toBeGreaterThan(180_000);
  const { result, getFullTextChecks } = await rebound();
  expect((await result).identity).toBe("group:assistant:persisted");
  expect(getFullTextChecks()).toBe(0);
});

test("multipart response rebinds past a content-free optimistic shell", async () => {
  const { result } = await rebound({ staleShell: true });
  expect((await result).identity).toBe("group:assistant:persisted");
});

test("multipart response remains bound while its acknowledgement is still streaming", async () => {
  const { result } = await rebound({ responseStillStreaming: true, acknowledgement: "CODEX_MULTIPART" });
  expect((await result).identity).toBe("group:assistant:persisted");
});

test("multipart rebinding rejects altered identifiers, wrong ACK, competing and changed turns", async () => {
  for (const scenario of [
    { header: stage.text.slice(0, 1_500).replace(stage.sha256, "f".repeat(64)) },
    { header: stage.text.slice(0, 1_500).replace(`ctx_${"e".repeat(32)}`, `ctx_${"f".repeat(32)}`) },
    { header: "Some other user message" },
    { acknowledgement: "CODEX_MULTIPART_ACK wrong" },
    { extraTurn: true },
    { staleShell: true, competingShell: true },
    { changeAfterEvidence: true },
    { changeAckAfterEvidence: true },
  ]) {
    const { result } = await rebound(scenario);
    await expect(result).rejects.toThrow();
  }
});
