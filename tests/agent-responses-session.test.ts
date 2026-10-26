import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, providerConfig } from "../src/config";
import { TurnBroker, callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { ChatGptBrowserViewportUnavailableError } from "../src/adapters/chatgpt-web/browser-worker";
import { AgentResponsesSessionManager } from "../src/integrations/agent-responses/session-manager";
import { parseAgentResponsesRequest } from "../src/integrations/agent-responses/request";

const model = "chatgpt-web/gpt-5.6-luna";
const backendModel = { backendModel: "gpt-5.6-luna", adapterEffort: "low" };
const tool = {
  type: "function", name: "Read", description: "Read an agent-side file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};
const root = mkdtempSync(join(tmpdir(), "cgw-agent-session-"));
const broker = TurnBroker.forSocket(join(root, "broker.sock"));
afterAll(async () => { await broker.close(); rmSync(root, { recursive: true, force: true }); });

const output = (callId: string, text: string) => ({ type: "function_call_output", call_id: callId, output: text });
const request = (input: unknown) => parseAgentResponsesRequest({ model, input, tools: [tool] });

test("unknown tool result cannot ACK any genuine member of a parallel batch", async () => {
  const manager = new AgentResponsesSessionManager(broker, providerConfig(defaultConfig("full")), {
    async run(turn) {
      const token = (await turn.prepare()).turnToken!;
      const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath,
        { method: "claim", token });
      await callTurnBroker(broker.socketPath,
        { method: "activity_complete", token, activityId: claimed.activityId });
      const pending = ["first.ts", "second.ts"].map(path => callTurnBroker<{ content: Array<{ text: string }> }>(
        broker.socketPath,
        { method: "invoke", bindingId: claimed.bindingId, wireName: "Read", freeform: false, arguments: { path } }, null));
      const progress = turn.externalProgress!;
      while (progress.snapshot().lastToolBatchRevision === 0) {
        await progress.waitForChange(progress.snapshot().revision);
      }
      await progress.acknowledgeToolBatch(progress.snapshot().lastToolBatchRevision);
      return (await Promise.all(pending)).map(result => result.content[0]?.text).join(" | ");
    },
  });
  const input = "Read two agent files";
  try {
    const first = await manager.start(request(input), backendModel);
    expect(first.calls).toHaveLength(2);
    const a = first.calls[0]!.callId;
    const b = first.calls[1]!.callId;
    const forged = `call_${"f".repeat(32)}`;
    expect([a, b]).not.toContain(forged);

    await expect(manager.continue(request([
      { role: "user", content: input }, output(a, "one"), output(b, "two"), output(forged, "forged"),
    ]))).rejects.toMatchObject({ status: 409 });
    expect(manager.hasPendingCall(a)).toBe(true);
    expect(manager.hasPendingCall(b)).toBe(true);

    const final = await manager.continue(request([
      { role: "user", content: input }, output(a, "one"), output(b, "two"),
    ]));
    expect(final).toEqual({ text: "one | two", calls: [], finished: true });
  } finally { manager.closeAll(); }
});

test("generic text turn keeps external authority and completes without a native tool connector", async () => {
  const manager = new AgentResponsesSessionManager(broker, providerConfig(defaultConfig("full")), {
    async run(turn) {
      expect(turn.nativeConnector).toBe(false);
      expect(turn.capabilities.localToolsEnabled).toBe(false);
      expect((await turn.prepare()).turnToken).toMatch(/^turn_[A-Za-z0-9_-]+$/);
      return "Public answer";
    },
  });
  try {
    const stage = await manager.start(parseAgentResponsesRequest({ model, input: "Answer in text" }), backendModel);
    expect(stage).toEqual({ text: "Public answer", calls: [], finished: true });
    expect(manager.activeCount()).toBe(0);
  } finally { manager.closeAll(); }
});

test("cancelAll retires live generic broker owners without permanently disabling the provider", async () => {
  let entered!: () => void;
  const browserStarted = new Promise<void>(resolve => { entered = resolve; });
  const manager = new AgentResponsesSessionManager(broker, providerConfig(defaultConfig("full")), {
    async run(turn) {
      await turn.prepare();
      entered();
      return new Promise<string>((_resolve, reject) => {
        const signal = turn.abortSignal!;
        const onAbort = () => reject(signal.reason);
        signal.addEventListener("abort", onAbort, { once: true });
        if (signal.aborted) onAbort();
      });
    },
  });
  try {
    const pending = manager.start(parseAgentResponsesRequest({ model, input: "Wait" }), backendModel);
    await browserStarted;
    expect(manager.activeCount()).toBe(1);
    expect(broker.externalOwnerActiveCount()).toBeGreaterThan(0);
    expect(manager.cancelAll()).toBe(1);
    await expect(pending).rejects.toThrow();
    expect(manager.activeCount()).toBe(0);
    expect(manager.cancelAll()).toBe(0);
  } finally { manager.closeAll(); }
});

test("cancelAll invalidates a broker registration still pending when cancellation begins", async () => {
  let releaseRegistration!: () => void;
  let sawRegistration!: () => void;
  const blocked = new Promise<void>(resolve => { releaseRegistration = resolve; });
  const entered = new Promise<void>(resolve => { sawRegistration = resolve; });
  let revoked = 0;
  let browserRuns = 0;
  const pendingBroker = {
    register: async () => { sawRegistration(); await blocked; return "turn_delayed_owner"; },
    revoke: async () => { revoked++; },
  } as unknown as TurnBroker;
  const manager = new AgentResponsesSessionManager(pendingBroker, providerConfig(defaultConfig("full")), {
    async run() { browserRuns++; return "Unexpected browser send"; },
  });
  try {
    const pending = manager.start(parseAgentResponsesRequest({ model, input: "Never send" }), backendModel);
    await entered;
    expect(manager.activeCount()).toBe(1);
    expect(manager.cancelAll()).toBe(0);
    releaseRegistration();
    await expect(pending).rejects.toMatchObject({ status: 499 });
    expect(revoked).toBe(1);
    expect(browserRuns).toBe(0);
    expect(manager.activeCount()).toBe(0);
  } finally { releaseRegistration(); manager.closeAll(); }
});

test("pre-Send viewport recovery reuses one broker owner and sends once", async () => {
  let attempts = 0;
  let sends = 0;
  const tokens: string[] = [];
  const manager = new AgentResponsesSessionManager(broker, providerConfig(defaultConfig("full")), {
    async run(turn) {
      attempts += 1;
      tokens.push((await turn.prepare()).turnToken!);
      if (attempts === 1) throw new ChatGptBrowserViewportUnavailableError("collapsed viewport");
      turn.onSendActivated?.();
      sends += 1;
      turn.onSubmitted?.();
      return "Recovered";
    },
  });
  try {
    expect(await manager.start(parseAgentResponsesRequest({ model, input: "Try once safely" }), backendModel))
      .toEqual({ text: "Recovered", calls: [], finished: true });
    expect(attempts).toBe(2);
    expect(sends).toBe(1);
    expect(new Set(tokens).size).toBe(1);
  } finally { manager.closeAll(); }
});

test("viewport failure after Send activation never replays a browser submission", async () => {
  let attempts = 0;
  const manager = new AgentResponsesSessionManager(broker, providerConfig(defaultConfig("full")), {
    async run(turn) {
      attempts += 1;
      await turn.prepare();
      turn.onSendActivated?.();
      throw new ChatGptBrowserViewportUnavailableError("collapsed after sending");
    },
  });
  try {
    await expect(manager.start(parseAgentResponsesRequest({ model, input: "No replay" }), backendModel))
      .rejects.toThrow("operational viewport");
    expect(attempts).toBe(1);
    expect(manager.activeCount()).toBe(0);
  } finally { manager.closeAll(); }
});
