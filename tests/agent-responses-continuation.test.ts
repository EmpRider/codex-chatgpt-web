import { afterAll, expect, jest, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint, defaultConfig, providerConfig } from "../src/config";
import { TurnBroker, callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { AgentResponsesSessionManager } from "../src/integrations/agent-responses/session-manager";
import { parseAgentResponsesRequest } from "../src/integrations/agent-responses/request";

const model = "chatgpt-web/gpt-5.6-luna";
const backend = { backendModel: "gpt-5.6-luna", adapterEffort: "low" };
const tool = { type: "function", name: "Read", description: "Read an agent-side file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } };
const root = mkdtempSync(join(tmpdir(), "cgw-agent-continuation-"));
const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
afterAll(async () => { await broker.close(); rmSync(root, { recursive: true, force: true }); });

for (const timerFirst of [true, false]) test(`owner expiry rejects a live RPC at the deadline (${timerFirst ? "timer first" : "admission first"})`, async () => {
  const manager = managerFor([["boundary.ts"]], broker, 1_000, () => jest.useFakeTimers());
  try {
    const stage = await manager.start(request("Read boundary.ts"), backend);
    const id = stage.calls[0]!.callId;
    const continuation = request([{ role: "user", content: "Read boundary.ts" }, output(id, "late")]);
    jest.advanceTimersByTime(999);
    expect(manager.activeCount()).toBe(1);
    expect(manager.hasPendingCall(id)).toBe(true);
    if (timerFirst) jest.advanceTimersByTime(1);
    else jest.setSystemTime(Date.now() + 1);
    expect(manager.hasPendingCall(id)).toBe(false);
    expect(manager.activeCount()).toBe(0);
    await expect(manager.continue(continuation)).rejects.toMatchObject({ status: 409 });
    jest.advanceTimersByTime(1);
    await expect(manager.continue(continuation)).rejects.toMatchObject({ status: 409 });
    expect(manager.activeCount()).toBe(0);
  } finally {
    manager.closeAll();
    jest.useRealTimers();
  }
});

const output = (callId: string, text: string) => ({ type: "function_call_output", call_id: callId, output: text });
const richOutput = (callId: string, text: string, version = 1) => ({
  type: "function_call_output", call_id: callId,
  output: { content: [{ type: "text", text }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    structuredContent: { path: "first.ts", version }, isError: true },
});
const request = (input: unknown) => parseAgentResponsesRequest({ model, input, tools: [tool] });

function managerFor(rounds: string[][], owner: TurnBroker = broker, toolResultTtlMs?: number,
  beforeBatchAcknowledged: () => void = () => {}): AgentResponsesSessionManager {
  return new AgentResponsesSessionManager(owner, providerConfig(defaultConfig("full")), {
    async run(turn) {
      const token = (await turn.prepare()).turnToken!;
      const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath,
        { method: "claim", token });
      await callTurnBroker(broker.socketPath,
        { method: "activity_complete", token, activityId: claimed.activityId });
      const progress = turn.externalProgress!;
      let revision = 0;
      const received: string[] = [];
      for (const paths of rounds) {
        const pending = paths.map(path => callTurnBroker<{ content: Array<{ text?: string }> }>(broker.socketPath,
          { method: "invoke", bindingId: claimed.bindingId, wireName: "Read", freeform: false, arguments: { path } }, null));
        while (progress.snapshot().lastToolBatchRevision <= revision) {
          await progress.waitForChange(progress.snapshot().revision);
        }
        revision = progress.snapshot().lastToolBatchRevision;
        beforeBatchAcknowledged();
        await progress.acknowledgeToolBatch(revision);
        received.push(...(await Promise.all(pending)).map(result => result.content[0]?.text ?? ""));
      }
      return received.join(" | ");
    },
  }, toolResultTtlMs);
}

test("historical broker-ACKed output has immutable rich content, error flag and structured content", async () => {
  const manager = managerFor([["first.ts"], ["second.ts"]]);
  const question = "Read first.ts, then second.ts";
  try {
    const first = await manager.start(request(question), backend);
    expect(first.calls).toHaveLength(1);
    const a = first.calls[0]!.callId;
    const acceptedA = richOutput(a, "first-content");
    const second = await manager.continue(request([{ role: "user", content: question }, acceptedA]));
    expect(second.calls).toHaveLength(1);
    const b = second.calls[0]!.callId;

    for (const alteredA of [
      richOutput(a, "changed-content"), richOutput(a, "first-content", 2),
      { ...acceptedA, is_error: false, output: { ...acceptedA.output, isError: false } },
    ]) {
      await expect(manager.continue(request([
        { role: "user", content: question }, alteredA, output(b, "second-content"),
      ]))).rejects.toMatchObject({ status: 409 });
      expect(manager.hasPendingCall(b)).toBe(true);
    }

    const finished = await manager.continue(request([
      { role: "user", content: question }, acceptedA, output(b, "second-content"),
    ]));
    expect(finished).toEqual({ text: "first-content | second-content", calls: [], finished: true });
  } finally { manager.closeAll(); }
});

test("caller-provided tool history predating this session is inert but its original prefix stays fixed", async () => {
  const manager = managerFor([["fresh.ts"]]);
  const old = output(`call_${"o".repeat(32)}`, "historical context only");
  const initial = [old, { role: "user", content: "Now read fresh.ts" }];
  try {
    const first = await manager.start(request(initial), backend);
    const live = first.calls[0]!.callId;
    await expect(manager.continue(request([
      output(old.call_id, "tampered old context"), initial[1], output(live, "fresh"),
    ]))).rejects.toMatchObject({ status: 409 });
    expect(manager.hasPendingCall(live)).toBe(true);
    const final = await manager.continue(request([...initial, output(live, "fresh")]));
    expect(final).toEqual({ text: "fresh", calls: [], finished: true });
  } finally { manager.closeAll(); }
});

test("missing, duplicate and placeholder outputs reject the entire outstanding batch", async () => {
  const manager = managerFor([["first.ts", "second.ts"]]);
  const question = "Read two files";
  try {
    const first = await manager.start(request(question), backend);
    const a = first.calls[0]!.callId;
    const b = first.calls[1]!.callId;
    for (const batch of [
      [output(a, "one")],
      [output(a, "one"), output(a, "duplicate")],
      [output(a, "[No response received]"), output(b, "two")],
      [output(a, "one"), output(`call_${"f".repeat(32)}`, "foreign or forged")],
    ]) {
      await expect(manager.continue(request([{ role: "user", content: question }, ...batch])))
        .rejects.toMatchObject({ status: 409 });
      expect(manager.hasPendingCall(a)).toBe(true);
      expect(manager.hasPendingCall(b)).toBe(true);
    }
    expect(await manager.continue(request([
      { role: "user", content: question }, output(a, "one"), output(b, "two"),
    ]))).toEqual({ text: "one | two", calls: [], finished: true });
  } finally { manager.closeAll(); }
});

test("two concurrent owners cannot accept each other's tool output", async () => {
  const firstManager = managerFor([["first.ts"]]);
  const secondManager = managerFor([["second.ts"]]);
  const q1 = "Read first.ts";
  const q2 = "Read second.ts";
  try {
    const a = (await firstManager.start(request(q1), backend)).calls[0]!.callId;
    const b = (await secondManager.start(request(q2), backend)).calls[0]!.callId;
    await expect(firstManager.continue(request([
      { role: "user", content: q1 }, output(a, "one"), output(b, "stolen"),
    ]))).rejects.toMatchObject({ status: 409 });
    expect(firstManager.hasPendingCall(a)).toBe(true);
    expect(secondManager.hasPendingCall(b)).toBe(true);
    expect(await firstManager.continue(request([
      { role: "user", content: q1 }, output(a, "one"),
    ]))).toMatchObject({ text: "one", finished: true });
    expect(await secondManager.continue(request([
      { role: "user", content: q2 }, output(b, "two"),
    ]))).toMatchObject({ text: "two", finished: true });
  } finally { firstManager.closeAll(); secondManager.closeAll(); }
});

test("unknown partial broker ACK retires owner and forbids continuation replay", async () => {
  let completed = 0;
  const failingBroker = new Proxy(broker, {
    get(target, property) {
      if (property === "completeTool") return async (...args: Parameters<TurnBroker["completeTool"]>) => {
        completed += 1;
        if (completed === 2) throw new Error("Simulated lost second broker ACK");
        return target.completeTool(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manager = managerFor([["first.ts", "second.ts"]], failingBroker);
  const question = "Read two files";
  try {
    const first = await manager.start(request(question), backend);
    const a = first.calls[0]!.callId;
    const b = first.calls[1]!.callId;
    const continuation = request([
      { role: "user", content: question }, output(a, "one"), output(b, "two"),
    ]);
    await expect(manager.continue(continuation)).rejects.toMatchObject({ status: 409 });
    expect(completed).toBe(2);
    expect(manager.activeCount()).toBe(0);
    expect(manager.hasPendingCall(a)).toBe(false);
    expect(manager.hasPendingCall(b)).toBe(false);
    await expect(manager.continue(continuation)).rejects.toMatchObject({ status: 409 });
    expect(completed).toBe(2);
  } finally { manager.closeAll(); }
});

test("concurrent continuation cannot hand off a live output twice", async () => {
  let entered!: () => void;
  let release!: () => void;
  const enteredFirstHandoff = new Promise<void>(resolve => { entered = resolve; });
  const resumeFirstHandoff = new Promise<void>(resolve => { release = resolve; });
  let handoffs = 0;
  const delayedBroker = new Proxy(broker, {
    get(target, property) {
      if (property === "completeTool") return async (...args: Parameters<TurnBroker["completeTool"]>) => {
        handoffs += 1;
        if (handoffs === 1) { entered(); await resumeFirstHandoff; }
        return target.completeTool(...args);
      };
      const value = Reflect.get(target, property);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manager = managerFor([["first.ts"]], delayedBroker);
  const question = "Read one file";
  try {
    const first = await manager.start(request(question), backend);
    const a = first.calls[0]!.callId;
    const continuation = request([{ role: "user", content: question }, output(a, "one")]);
    const firstConsumer = manager.continue(continuation);
    await enteredFirstHandoff;
    const secondResult = await manager.continue(continuation).then(() => "accepted", error => (error as { status?: number }).status);
    release();
    const firstResult = await firstConsumer.then(stage => stage, error => (error as { status?: number }).status);
    expect(secondResult).toBe(409);
    expect(handoffs).toBe(1);
    expect(firstResult).toEqual({ text: "one", calls: [], finished: true });
  } finally { release(); manager.closeAll(); }
});

test("rejected contender cannot overwrite winner request ID or cancel its broker owner", async () => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let handoffs = 0;
  const delayed = new Proxy(broker, {
    get(target, key) {
      if (key === "completeTool") return async (...args: Parameters<TurnBroker["completeTool"]>) => {
        handoffs += 1;
        entered();
        await gate;
        return target.completeTool(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manager = managerFor([["first.ts"]], delayed);
  const question = "Read one file";
  try {
    const id = (await manager.start(request(question), backend)).calls[0]!.callId;
    const payload = request([{ role: "user", content: question }, output(id, "one")]);
    const winner = manager.continue(payload, undefined, "winner-request");
    await waiting;
    const loserSignal = new AbortController();
    await expect(manager.continue(payload, loserSignal.signal, "loser-request"))
      .rejects.toMatchObject({ status: 409 });
    // Verify this security-critical mutation without adding a test-only public method.
    const live = [...(manager as unknown as { sessions: Set<{ requestId?: string }> }).sessions][0];
    expect(live?.requestId).toBe("winner-request");
    loserSignal.abort(new Error("loser disconnected"));
    expect(manager.hasPendingCall(id)).toBe(true);
    expect(manager.activeCount()).toBe(1);
    expect(handoffs).toBe(1);
    release();
    expect(await winner).toEqual({ text: "one", calls: [], finished: true });
  } finally { release(); manager.closeAll(); }
});

test("winner cancellation during pending broker ACK retires owner and cannot replay late result", async () => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  let handoffs = 0;
  const delayed = new Proxy(broker, {
    get(target, key) {
      if (key === "completeTool") return async (...args: Parameters<TurnBroker["completeTool"]>) => {
        handoffs += 1;
        entered();
        await gate;
        return target.completeTool(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manager = managerFor([["first.ts"]], delayed);
  const question = "Read one file";
  try {
    const id = (await manager.start(request(question), backend)).calls[0]!.callId;
    const payload = request([{ role: "user", content: question }, output(id, "one")]);
    const abort = new AbortController();
    const ownerStatus = manager.continue(payload, abort.signal).then(() => "accepted", error => (error as { status?: number }).status);
    await waiting;
    abort.abort(new Error("client disconnected"));
    expect(await ownerStatus).toBe(409);
    expect(manager.activeCount()).toBe(0);
    expect(manager.hasPendingCall(id)).toBe(false);
    release();
    await expect(manager.continue(payload)).rejects.toMatchObject({ status: 409 });
    expect(handoffs).toBe(1);
  } finally { release(); manager.closeAll(); }
});

test("tool-result expiry during held broker ACK retires session without restarting it", async () => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delayed = new Proxy(broker, {
    get(target, key) {
      if (key === "completeTool") return async (...args: Parameters<TurnBroker["completeTool"]>) => {
        entered();
        await gate;
        return target.completeTool(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const manager = managerFor([["first.ts"]], delayed, 40);
  const question = "Read one file";
  try {
    const id = (await manager.start(request(question), backend)).calls[0]!.callId;
    const payload = request([{ role: "user", content: question }, output(id, "one")]);
    const result = manager.continue(payload).then(() => "accepted", error => (error as { status?: number }).status);
    await waiting;
    await new Promise<void>(resolve => setTimeout(resolve, 75));
    expect(await result).toBe(409);
    expect(manager.activeCount()).toBe(0);
    expect(manager.hasPendingCall(id)).toBe(false);
    release();
    await expect(manager.continue(payload)).rejects.toMatchObject({ status: 409 });
  } finally { release(); manager.closeAll(); }
});

test("unrelated session can complete while another owner has a held broker ACK", async () => {
  let entered!: () => void;
  let release!: () => void;
  const waiting = new Promise<void>(resolve => { entered = resolve; });
  const gate = new Promise<void>(resolve => { release = resolve; });
  const delayed = new Proxy(broker, {
    get(target, key) {
      if (key === "completeTool") return async (...args: Parameters<TurnBroker["completeTool"]>) => {
        entered();
        await gate;
        return target.completeTool(...args);
      };
      const value = Reflect.get(target, key);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
  const firstManager = managerFor([["first.ts"]], delayed);
  const secondManager = managerFor([["second.ts"]]);
  try {
    const a = (await firstManager.start(request("First independent task"), backend)).calls[0]!.callId;
    const b = (await secondManager.start(request("Second independent task"), backend)).calls[0]!.callId;
    const held = firstManager.continue(request([{ role: "user", content: "First independent task" }, output(a, "one")]));
    await waiting;
    expect(await secondManager.continue(request([
      { role: "user", content: "Second independent task" }, output(b, "two"),
    ]))).toEqual({ text: "two", calls: [], finished: true });
    release();
    expect(await held).toEqual({ text: "one", calls: [], finished: true });
  } finally { release(); firstManager.closeAll(); secondManager.closeAll(); }
});
