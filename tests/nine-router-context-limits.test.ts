import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, providerConfig } from "../src/config";
import type { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { NineRouterProvider } from "../src/integrations/nine-router/routes";
import { NineRouterSessionManager } from "../src/integrations/nine-router/session-manager";
import { NineRouterAttemptJournal } from "../src/integrations/nine-router/attempt-journal";
import { parseNineRouterRequest } from "../src/integrations/nine-router/request";
import { assertChatGptWebInputWithinLimits } from "../src/adapters/chatgpt-web/browser-worker";

const path = "/integrations/9router/v1/responses";
const modelsPath = "/integrations/9router/v1/models";
const key = "test-only_" + "k".repeat(40);
const makeConfig = (proAvailable: boolean, experimentalBiggerContext = true) => {
  const config = defaultConfig("full");
  config.browserInteractionMode = "automatic";
  config.solAvailable = true;
  config.proAvailable = proAvailable;
  config.experimentalBiggerContext = experimentalBiggerContext;
  return config;
};
const makeRequest = (input: string, stream: boolean) => new Request(`http://127.0.0.1${path}`, {
  method: "POST",
  headers: { authorization: `Bearer ${key}`, "content-type": "application/json", "idempotency-key": "context-retry-123" },
  body: JSON.stringify({ model: "chatgpt-web/gpt-6-sol", input, stream }),
});
const temporaryDirectories: string[] = [];
afterAll(() => { for (const directory of temporaryDirectories) rmSync(directory, { recursive: true, force: true }); });

test("9Router model discovery exposes the actual Plus, Pro and standard context budgets", async () => {
  for (const [proAvailable, biggerContext, window, compact] of [
    [false, true, 120_000, 110_000],
    [true, true, 240_000, 220_000],
    [false, false, 90_000, 80_000],
  ] as const) {
    const config = makeConfig(proAvailable, biggerContext);
    const provider = new NineRouterProvider(config, {} as TurnBroker, key);
    try {
      const response = await provider.handle(new Request(`http://127.0.0.1${modelsPath}`, {
        headers: { authorization: `Bearer ${key}` },
      }), modelsPath);
      const catalog = await response.json() as { data: Array<Record<string, unknown>> };
      const selected = catalog.data.find(entry => entry.id === "chatgpt-web/gpt-6-sol");
      expect(selected).toMatchObject({ context_length: window, context_window: window,
        auto_compact_token_limit: compact });
      const instant = catalog.data.find(entry => entry.id === "chatgpt-web/gpt-6-sol-instant");
      if (!proAvailable) expect(instant?.context_window).toBe(41_000);
    } finally { provider.close(); }
  }
  const lunaConfig = makeConfig(false, false);
  lunaConfig.solAvailable = false;
  const provider = new NineRouterProvider(lunaConfig, {} as TurnBroker, key);
  try {
    const response = await provider.handle(new Request(`http://127.0.0.1${modelsPath}`, {
      headers: { authorization: `Bearer ${key}` },
    }), modelsPath);
    const catalog = await response.json() as { data: Array<Record<string, unknown>> };
    const luna = catalog.data.find(entry => entry.id === "chatgpt-web/gpt-5.6-luna");
    expect(luna).toMatchObject({ context_length: 28_000, auto_compact_token_limit: 19_808 });
  } finally { provider.close(); }
});

test("GPT-6 Instant cannot accidentally inherit GPT-5.6 Bigger Context when inline", () => {
  const capabilities = { localToolsEnabled: false, solAvailable: true, proAvailable: false,
    extraHighAvailable: false, experimentalBiggerContext: true };
  expect(() => assertChatGptWebInputWithinLimits(
    41_000, 30_000, "gpt-5.6-sol", "low", capabilities, 100_000, "6",
  )).toThrow("41,000-token context window");
});

test("ordinary Plus and Luna contexts are preflighted even without multipart transport", () => {
  for (const [solAvailable, model, backendModel, effort, payload] of [
    [true, "chatgpt-web/gpt-6-sol", "gpt-5.6-sol", "high", "a!b@c#d$".repeat(16_000)],
    [false, "chatgpt-web/gpt-5.6-luna", "gpt-5.6-luna", "low", "a!b@c#d$".repeat(5_000)],
  ] as const) {
    const config = makeConfig(false, false);
    config.solAvailable = solAvailable;
    let brokerRegistrations = 0;
    const broker = { register: async () => { brokerRegistrations++; return "unreachable"; } } as unknown as TurnBroker;
    const manager = new NineRouterSessionManager(broker, providerConfig(config));
    try {
      expect(() => manager.preflight(parseNineRouterRequest({ model, input: payload }), {
        backendModel, adapterEffort: effort, modelFamily: solAvailable ? "6" : "5.6",
      })).toThrow("/compact");
      expect(brokerRegistrations).toBe(0);
    } finally { manager.closeAll(); }
  }
});

test("oversized Plus Bigger Context returns Claude-compatible HTTP 400 before broker, journal, SSE or Send", async () => {
  const config = makeConfig(false);
  const dir = mkdtempSync(join(tmpdir(), "r9-overflow-admission-"));
  temporaryDirectories.push(dir);
  let registered = 0;
  let browserRuns = 0;
  const fakeBroker = {
    register: async () => { registered++; return `turn_${"a".repeat(32)}`; },
    revoke: async () => {},
    nextToolBatch: () => new Promise(() => {}),
  } as unknown as TurnBroker;
  const manager = new NineRouterSessionManager(fakeBroker, providerConfig(config), {
    async run() { browserRuns++; return "recovered"; },
  });
  const provider = new NineRouterProvider(config, fakeBroker, key, manager, new NineRouterAttemptJournal(dir));
  try {
    // Mixed punctuation forces >120k estimated tokens while each multipart fragment
    // stays under the individual composer limit. This resembles accumulated tool outputs.
    const overflow = "a!b@c#d$".repeat(38_000);
    for (const stream of [true, false]) {
      const rejected = await provider.handle(makeRequest(overflow, stream), path);
      expect(rejected.status).toBe(400);
      expect(rejected.headers.get("content-type")).toContain("application/json");
      const payload = await rejected.json() as { error: Record<string, unknown> };
      expect(payload.error).toMatchObject({ code: "context_length_exceeded",
        context_window: 120_000, auto_compact_token_limit: 110_000 });
      // 9Router's upstream error translator wraps this as `[400]: <message>`.
      // Keep Claude Code's reactive compaction trigger recognizable after translation.
      expect(payload.error.message).toMatch(/^Prompt is too long\./);
      expect(payload.error.message).toContain("/compact");
      expect(payload.error.estimated_input_tokens).toBeGreaterThanOrEqual(120_000);
      expect(registered).toBe(0);
      expect(browserRuns).toBe(0);
      expect(manager.activeCount()).toBe(0);
      expect(readdirSync(dir)).toHaveLength(0);
    }
    // The first request never reached Send, so compacted history can use the same
    // logical request key. Once accepted, that key is durably protected against replay.
    const compacted = await provider.handle(makeRequest("Summarized verified history", false), path);
    expect(compacted.status).toBe(200);
    expect((await compacted.text())).toContain("recovered");
    expect(registered).toBe(1);
    expect(browserRuns).toBe(1);
    expect(readdirSync(dir)).toHaveLength(1);
    const duplicate = await provider.handle(makeRequest("Summarized verified history", false), path);
    expect(duplicate.status).toBe(409);
    expect(browserRuns).toBe(1);
  } finally { provider.close(); }
});

test("a 44-round synthetic conversation that jumps above the ceiling is rejected without side effects", () => {
  const config = makeConfig(false);
  let registrations = 0;
  const fakeBroker = { register: async () => { registrations++; return "unexpected"; } } as unknown as TurnBroker;
  const manager = new NineRouterSessionManager(fakeBroker, providerConfig(config));
  try {
    const rounds = Array.from({ length: 44 }, (_, i) => ({
      role: i % 2 === 0 ? "user" : "assistant",
      content: [{ type: "input_text", text: `Step ${i}: ${"a!b@c#d$".repeat(950)}` }],
    }));
    // A single unexpectedly large tool response can leap past any proactive threshold.
    rounds.push({ role: "user", content: [{ type: "input_text", text: `Tool result: ${"a!b@c#d$".repeat(17_000)}` }] });
    const req = { model: "chatgpt-web/gpt-6-sol", input: rounds };
    expect(() => manager.preflight(
      // Reuse the real parser to exercise role preservation and overhead estimation.
      // A rejected preflight is never allowed to register a broker owner.
      parseRequest(req), { backendModel: "gpt-5.6-sol", adapterEffort: "high", modelFamily: "6" },
    )).toThrow("/compact");
    expect(registrations).toBe(0);
  } finally { manager.closeAll(); }
});

function parseRequest(value: unknown) {
  // Kept local to avoid bypassing real OpenAI Responses normalization in the stress case.
  return parseNineRouterRequest(value);
}
