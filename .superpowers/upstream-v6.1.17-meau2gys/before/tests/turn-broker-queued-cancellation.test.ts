import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultBrokerEndpoint } from "../src/config";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

async function fixture() {
  const root = mkdtempSync(join(tmpdir(), "cgw-queued-cancel-"));
  const broker = TurnBroker.forSocket(defaultBrokerEndpoint(root));
  const token = await broker.register({ kind: "external-agent", tools: [] });
  const { bindingId } = await callTurnBroker<{ bindingId: string }>(broker.socketPath, { method: "claim", token });
  let queued: (() => void) | undefined;
  const log = spyOn(console, "info").mockImplementation(message => {
    if (String(message).includes(" queued call=")) queued?.();
  });
  const invoke = (callId: string) => callTurnBroker(broker.socketPath, {
    method: "invoke", bindingId, callId, wireName: "Read", arguments: { path: "private.ts" },
  }, null).then(() => "completed", () => "rejected");
  return {
    broker, token, bindingId, invoke,
    async enqueue(callId: string) {
      const accepted = new Promise<void>(resolve => { queued = resolve; });
      const outcome = invoke(callId);
      await accepted;
      return { outcome };
    },
    cancel: (callId: string) => callTurnBroker<{ cancelled: boolean }>(broker.socketPath, {
      method: "cancel_queued", bindingId, callId,
    }),
    async close() {
      try { await broker.close(); }
      finally { log.mockRestore(); rmSync(root, { recursive: true, force: true }); }
    },
  };
}

const id = (value: string) => `call_${value.repeat(32)}`;

test("queued cancellation rejects malformed identities and cannot affect a native binding", async () => {
  const f = await fixture();
  try {
    for (const callId of ["short", "call_../invalid", [id("a")]]) {
      await expect(callTurnBroker(f.broker.socketPath, {
        method: "cancel_queued", bindingId: f.bindingId, callId,
      } as Parameters<typeof callTurnBroker>[1])).rejects.toThrow("invalid");
    }
    const token = await f.broker.register({ cwd: ".", roots: [], writableRoots: [],
      sandboxPolicy: { type: "dangerFullAccess" }, tools: [] });
    const { bindingId } = await callTurnBroker<{ bindingId: string }>(f.broker.socketPath, { method: "claim", token });
    expect(await callTurnBroker<{ cancelled: boolean }>(f.broker.socketPath, { method: "cancel_queued", bindingId, callId: id("a") }))
      .toEqual({ cancelled: false });
    expect(await callTurnBroker(f.broker.socketPath, { method: "resolve", bindingId })).toHaveProperty("environment");
  } finally { await f.close(); }
});

test("queued cancellation preserves a live sibling and prevents cancelled result handoff", async () => {
  const f = await fixture();
  try {
    const a = await f.enqueue(id("a"));
    const b = await f.enqueue(id("b"));
    expect(await f.cancel(id("a"))).toEqual({ cancelled: true });
    expect(await a.outcome).toBe("rejected");
    const batch = await f.broker.nextToolBatch(f.token);
    expect(batch.map(call => call.callId)).toEqual([id("b")]);
    await f.broker.completeTool(f.token, id("b"), { content: [{ type: "text", text: "genuine result" }] });
    expect(await b.outcome).toBe("completed");
    await expect(Promise.resolve().then(() => f.broker.completeTool(f.token, id("a"), { content: [] }))).rejects.toThrow();
    expect(await f.invoke(id("a"))).toBe("rejected");
    expect(await f.cancel(id("a"))).toEqual({ cancelled: true });
  } finally { await f.close(); }
});

test("cancellation overtaking invoke leaves a tombstone without dispatching work", async () => {
  const f = await fixture();
  try {
    expect(await f.cancel(id("a"))).toEqual({ cancelled: true });
    expect(await f.invoke(id("a"))).toBe("rejected");
    const b = await f.enqueue(id("b"));
    expect((await f.broker.nextToolBatch(f.token)).map(call => call.callId)).toEqual([id("b")]);
    await f.broker.completeTool(f.token, id("b"), { content: [] });
    expect(await b.outcome).toBe("completed");
  } finally { await f.close(); }
});

test("delivered and completed calls never produce queued cancellation proof or allow duplicate invocation", async () => {
  const f = await fixture();
  try {
    const a = await f.enqueue(id("a"));
    expect((await f.broker.nextToolBatch(f.token))[0]?.callId).toBe(id("a"));
    expect(await f.cancel(id("a"))).toEqual({ cancelled: false });
    expect(await f.invoke(id("a"))).toBe("rejected");
    await f.broker.completeTool(f.token, id("a"), { content: [] });
    expect(await a.outcome).toBe("completed");
    expect(await f.cancel(id("a"))).toEqual({ cancelled: false });
    expect(await f.invoke(id("a"))).toBe("rejected");
  } finally { await f.close(); }
});

test("queued cancellation identities are bounded without forgetting old tombstones", async () => {
  const f = await fixture();
  try {
    for (let i = 0; i < 1024; i++) {
      expect(await f.cancel(`call_${String(i).padStart(32, "0")}`)).toEqual({ cancelled: true });
    }
    expect(await f.cancel(id("z"))).toEqual({ cancelled: false });
    expect(await f.invoke(id("z"))).toBe("rejected");
    expect(await f.invoke(`call_${"0".repeat(32)}`)).toBe("rejected");
    expect(await f.cancel(`call_${"0".repeat(32)}`)).toEqual({ cancelled: true });
  } finally { await f.close(); }
}, 20_000);
