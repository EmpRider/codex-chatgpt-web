import { expect, test } from "bun:test";
import { defaultConfig, providerConfig } from "../src/config";
import type { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { ChatGptBrowserViewportUnavailableError } from "../src/adapters/chatgpt-web/browser-worker";
import { AgentResponsesSessionManager } from "../src/integrations/agent-responses/session-manager";
import { parseAgentResponsesRequest } from "../src/integrations/agent-responses/request";
import { AgentResponsesProvider } from "../src/integrations/agent-responses/routes";

const model = { backendModel: "gpt-5.6-luna", adapterEffort: "low" };

test("generic model discovery preserves actual Plus, Pro and Luna context ceilings", async () => {
  const key = `synthetic-operator-${"k".repeat(48)}`;
  for (const [proAvailable, biggerContext, window, compact] of [
    [false, true, 120_000, 110_000],
    [true, true, 240_000, 220_000],
    [false, false, 90_000, 80_000],
  ] as const) {
    const config = { ...defaultConfig("full"), proAvailable,
      solAvailable: true, browserInteractionMode: "automatic" as const,
      experimentalBiggerContext: biggerContext };
    const provider = new AgentResponsesProvider(config, {} as TurnBroker, key);
    try {
      const result = await provider.handle(new Request("http://127.0.0.1/v1/models", {
        headers: { authorization: `Bearer ${key}` },
      }), "/v1/models");
      expect(result.status).toBe(200);
      const payload = await result.json() as { data: Array<Record<string, unknown>> };
      expect(payload.data.find(entry => entry.id === "chatgpt-web/gpt-6-sol"))
        .toMatchObject({ context_length: window, context_window: window, auto_compact_token_limit: compact });
      if (!proAvailable) {
        expect(payload.data.find(entry => entry.id === "chatgpt-web/gpt-6-sol-instant")?.context_window)
          .toBe(41_000);
      }
    } finally { provider.close(); }
  }
  const config = { ...defaultConfig("full"), solAvailable: false, experimentalBiggerContext: false };
  const provider = new AgentResponsesProvider(config, {} as TurnBroker, key);
  try {
    const result = await provider.handle(new Request("http://127.0.0.1/v1/models", {
      headers: { authorization: `Bearer ${key}` },
    }), "/v1/models");
    const payload = await result.json() as { data: Array<Record<string, unknown>> };
    expect(payload.data.find(entry => entry.id === "chatgpt-web/gpt-5.6-luna"))
      .toMatchObject({ context_length: 28_000, auto_compact_token_limit: 19_808 });
  } finally { provider.close(); }
});

test("75 mixed provider failures retire all broker owners without retrying a potentially accepted Send", async () => {
  const config = defaultConfig("full");
  let issued = 0;
  let revoked = 0;
  let sends = 0;
  const attempts = new Map<string, number>();
  const broker = {
    register: async () => `stress_owner_${issued++}`,
    revoke: async () => { revoked++; },
    nextToolBatch: () => new Promise(() => {}),
  } as unknown as TurnBroker;
  const manager = new AgentResponsesSessionManager(broker, providerConfig(config), {
    async run(turn) {
      const token = (await turn.prepare()).turnToken!;
      const id = Number(token.slice("stress_owner_".length));
      const count = (attempts.get(token) ?? 0) + 1;
      attempts.set(token, count);
      if (id % 5 === 1 && count === 1) {
        throw new ChatGptBrowserViewportUnavailableError("synthetic collapsed viewport before Send");
      }
      if (id % 5 === 2) {
        return new Promise((_resolve, reject) => turn.abortSignal!.addEventListener("abort",
          () => reject(new Error("synthetic disconnected observer")), { once: true }));
      }
      if (id % 5 === 4) return new Promise(() => {});
      turn.onSendActivated?.();
      sends++;
      if (id % 5 === 3) throw new Error("synthetic browser crash after Send");
      turn.onTextDelta(`answer ${id}`);
      return `answer ${id}`;
    },
  }, 80_000, 25);
  try {
    for (let batch = 0; batch < 15; batch++) {
      const starts = Array.from({ length: 5 }, (_, index) => {
        const controller = new AbortController();
        if (index === 2) setTimeout(() => controller.abort(), 5);
        return manager.start(parseAgentResponsesRequest({ model: "chatgpt-web/gpt-5.6-luna",
          input: `stress batch ${batch}, agent ${index}` }), model, controller.signal);
      });
      const settled = await Promise.allSettled(starts);
      expect(settled.filter(result => result.status === "fulfilled")).toHaveLength(2);
      expect(manager.activeCount()).toBe(0);
    }
    expect(issued).toBe(75);
    expect(revoked).toBe(75);
    expect(sends).toBe(45);
    expect([...attempts.entries()].filter(([token]) => Number(token.slice("stress_owner_".length)) % 5 === 1)
      .every(([_token, count]) => count === 2)).toBe(true);
  } finally { manager.closeAll(); }
}, 30_000);

test("44-round large history rejects before external owner admission or browser execution", () => {
  const config = defaultConfig("full");
  config.solAvailable = true;
  config.experimentalBiggerContext = false;
  let registrations = 0;
  const broker = { register: async () => { registrations++; return "unexpected"; } } as unknown as TurnBroker;
  const manager = new AgentResponsesSessionManager(broker, providerConfig(config));
  try {
    const rounds = Array.from({ length: 44 }, (_, index) => ({
      role: index % 2 === 0 ? "user" : "assistant",
      content: [{ type: "input_text", text: `Step ${index}: ${"a!b@c#d$".repeat(950)}` }],
    }));
    rounds.push({ role: "user", content: [{ type: "input_text", text: `Tool result: ${"a!b@c#d$".repeat(17_000)}` }] });
    const request = parseAgentResponsesRequest({ model: "chatgpt-web/gpt-6-sol", input: rounds });
    expect(() => manager.preflight(request, {
      backendModel: "gpt-5.6-sol", adapterEffort: "high", modelFamily: "6",
    })).toThrow("/compact");
    expect(registrations).toBe(0);
    expect(manager.activeCount()).toBe(0);
  } finally { manager.closeAll(); }
});

test("six-part external multipart keeps every original record and remains an external agent", async () => {
  const config = defaultConfig("full");
  config.experimentalBiggerContext = true;
  let parts = 0;
  const broker = {
    register: async () => `turn_${"p".repeat(32)}`,
    revoke: async () => undefined,
    nextToolBatch: () => new Promise(() => {}),
  } as unknown as TurnBroker;
  const manager = new AgentResponsesSessionManager(broker, providerConfig(config), {
    async run(turn) {
      expect(turn.nativeConnector).toBe(false);
      expect(turn.capabilities.localToolsEnabled).toBe(false);
      const prepared = await turn.prepare();
      expect(prepared.multipart?.agentKind).toBe("external-agent");
      parts = prepared.multipart?.parts.length ?? 0;
      const records = prepared.multipart!.parts.flatMap(part =>
        (JSON.parse(part) as { records: Array<{ kind: string }> }).records);
      expect(records.filter(record => record.kind === "message")).toHaveLength(12);
      return "Every record retained";
    },
  });
  const request = parseAgentResponsesRequest({ model: "chatgpt-web/gpt-6-sol",
    input: Array.from({ length: 12 }, (_, index) => ({
      role: "user", content: `record-${index}:${"                              line".repeat(3_000)}`,
    })) });
  try {
    const result = await manager.start(request,
      { backendModel: "gpt-5.6-sol", adapterEffort: "high", modelFamily: "6" });
    expect(result).toMatchObject({ text: "Every record retained", finished: true });
    expect(parts).toBe(6);
  } finally { manager.closeAll(); }
}, 30_000);
