import { expect, test } from "bun:test";
import { createActivityContract, observeActivity, validateActivityEvent, type ActivityEvent } from "../src/activity-events";

const draft = {
  level: "INFO", category: "api", event: "request_started", phase: "admission", code: "ok",
} as const;

test("observer rejects caller-forged hex correlation while forwarding factory-owned events", () => {
  const trusted = createActivityContract().create(draft, { requestId: "synthetic-factory-request" });
  expect(trusted).not.toBeNull();

  const delivered: ActivityEvent[] = [];
  const sink = (event: ActivityEvent) => { delivered.push(event); };

  observeActivity(trusted, sink);
  expect(delivered).toHaveLength(1);
  expect(delivered[0]?.request_hash).toBe(trusted?.request_hash);

  // A structurally valid hex string may itself be a raw secret, not a keyed pseudonym.
  const syntheticHexSecret = "0123456789abcdef0123456789abcdef";
  observeActivity({ ...trusted, request_hash: syntheticHexSecret }, sink);

  expect(delivered).toHaveLength(1);
  expect(delivered.some(event => event.request_hash === syntheticHexSecret)).toBe(false);
});

test("unchanged spread clone and JSON reconstruction pass schema validation but never reach sink", () => {
  const original = createActivityContract().create(draft, { requestId: "private-request" });
  expect(original).not.toBeNull();
  const copied = { ...original };
  const parsed: unknown = JSON.parse(JSON.stringify(original));
  expect(validateActivityEvent(copied)).toEqual(original);
  expect(validateActivityEvent(parsed)).toEqual(original);

  const seen: ActivityEvent[] = [];
  observeActivity(copied, event => { seen.push(event); });
  observeActivity(parsed, event => { seen.push(event); });
  expect(seen).toEqual([]);
});

test("fabricated valid-shape 32-hex object has no observer provenance", () => {
  const fake = {
    version: 1 as const,
    at: "2026-10-26T00:00:00.000Z",
    ...draft,
    request_hash: "0123456789abcdef0123456789abcdef",
  };
  expect(validateActivityEvent(fake)).toEqual(fake);
  const seen: ActivityEvent[] = [];
  observeActivity(fake, event => { seen.push(event); });
  expect(seen).toEqual([]);
});

test("factory always HMACs raw-looking hex IDs and emits only frozen factory-owned records", () => {
  const rawHex = "0123456789abcdef0123456789abcdef";
  const created = createActivityContract().create(draft, { requestId: rawHex });
  expect(created).not.toBeNull();
  expect(Object.isFrozen(created)).toBe(true);
  expect(created?.request_hash).toMatch(/^[a-f0-9]{32}$/);
  expect(created?.request_hash).not.toBe(rawHex);
  const seen: ActivityEvent[] = [];
  observeActivity(created, event => { seen.push(event); });
  expect(seen).toHaveLength(1);
  expect(seen[0]?.request_hash).toBe(created?.request_hash);
});

test("observer accepts originals from independent factories in one module", () => {
  const first = createActivityContract().create(draft, { sessionId: "session-A" });
  const second = createActivityContract().create(draft, { sessionId: "session-B" });
  expect(first).not.toBeNull();
  expect(second).not.toBeNull();
  const seen: ActivityEvent[] = [];
  observeActivity(first, event => { seen.push(event); });
  observeActivity(second, event => { seen.push(event); });
  expect(seen).toHaveLength(2);
  expect(seen[0]?.session_hash).toBe(first?.session_hash);
  expect(seen[1]?.session_hash).toBe(second?.session_hash);
});

test("observer drops getter, Proxy and malformed candidates without executing sink", () => {
  const original = createActivityContract().create(draft);
  expect(original).not.toBeNull();
  const getter = { ...original };
  Object.defineProperty(getter, "code", { enumerable: true, get: () => { throw new Error("private canary"); } });
  const proxy = new Proxy(original!, { get: () => { throw new Error("secret"); } });
  const seen: ActivityEvent[] = [];
  const sink = (event: ActivityEvent) => { seen.push(event); };
  expect(() => observeActivity(getter, sink)).not.toThrow();
  expect(() => observeActivity(proxy, sink)).not.toThrow();
  expect(() => observeActivity(null, sink)).not.toThrow();
  expect(() => observeActivity({ ...original, event: "raw-prompt" }, sink)).not.toThrow();
  expect(seen).toEqual([]);
});
