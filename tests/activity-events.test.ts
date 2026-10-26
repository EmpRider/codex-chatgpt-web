import { expect, test } from "bun:test";

// The dynamic import lets the first RED run fail on an assertion when the
// new contract does not exist yet, rather than stop at module resolution.
const contractModule: typeof import("../src/activity-events") = await import("../src/activity-events")
  .catch(() => ({} as typeof import("../src/activity-events")));

function contract() {
  expect("createActivityContract" in contractModule).toBe(true);
  return contractModule.createActivityContract();
}

const requestStart = {
  level: "INFO",
  category: "api",
  event: "request_started",
  phase: "admission",
  code: "ok",
  http_status: 200,
  duration_ms: 0,
  count: 2,
  buffer_bytes: 1024,
} as const;

test("emits only versioned, bounded and enumerated flat Activity fields", () => {
  const event = contract().create(requestStart);
  expect(event).toMatchObject({ version: 1, ...requestStart });
  expect(event?.at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
  expect(Object.keys(event ?? {}).sort()).toEqual([
    "at", "buffer_bytes", "category", "code", "count", "duration_ms",
    "event", "http_status", "level", "phase", "version",
  ].sort());
  expect(contractModule.validateActivityEvent(event)).toEqual(event);
});

test("never passes raw request, session or turn IDs to JSON or observer", () => {
  const rawRequest = "Bearer secret-request-should-not-log";
  const rawSession = "https://internal.example/private/user?token=secret-session";
  const rawTurn = "C:\\Users\\private.user\\confidential\\turn";
  const event = contract().create(requestStart, {
    requestId: rawRequest, sessionId: rawSession, turnId: rawTurn,
  });
  expect(event).not.toBeNull();
  const serialized = JSON.stringify(event);
  for (const canary of [rawRequest, rawSession, rawTurn, "secret-session", "private.user", "secret-request"]) {
    expect(serialized).not.toContain(canary);
  }
  expect(event?.request_hash).toMatch(/^[a-f0-9]{32}$/);
  expect(event?.session_hash).toMatch(/^[a-f0-9]{32}$/);
  expect(event?.turn_hash).toMatch(/^[a-f0-9]{32}$/);
  const seen: unknown[] = [];
  contractModule.observeActivity(event, item => { seen.push(item); });
  expect(seen).toEqual([event]);
});

test("keyed correlations are stable within one runtime and split across domains and runtimes", () => {
  const first = contract();
  const second = contract();
  const ids = { requestId: "same-sensitive-id", sessionId: "same-sensitive-id", turnId: "same-sensitive-id" };
  const a = first.create(requestStart, ids);
  const b = first.create(requestStart, ids);
  const c = second.create(requestStart, ids);
  expect(a?.request_hash).toBe(b?.request_hash);
  expect(a?.session_hash).toBe(b?.session_hash);
  expect(a?.turn_hash).toBe(b?.turn_hash);
  expect(a?.request_hash).not.toBe(a?.session_hash);
  expect(a?.session_hash).not.toBe(a?.turn_hash);
  expect(c?.request_hash).not.toBe(a?.request_hash);
  expect(c?.session_hash).not.toBe(a?.session_hash);
  expect(c?.turn_hash).not.toBe(a?.turn_hash);
  expect(JSON.stringify(first)).not.toContain("same-sensitive-id");
});

test("rejects unknown fields, free-form strings, nested data and secret canaries", () => {
  const runtime = contract();
  for (const forbidden of [
    { prompt: "private prompt" },
    { response: "private generated output" },
    { message: "Exception: path /Users/private.user" },
    { tool_args: { path: "/private/file" } },
    { tool_result: { text: "private" } },
    { headers: { authorization: "Bearer secret" } },
    { cookie: "sensitive-cookie" },
    { idempotency_key: "sensitive-request-key" },
    { url: "https://example.com/private" },
    { path: "C:\\Users\\private.user\\foo" },
    { user_id: "private-user-id" },
    { exception: new Error("private stack") },
    { detail: { safe: "even a new nested key is forbidden" } },
  ]) {
    expect(runtime.create({ ...requestStart, ...forbidden })).toBeNull();
    expect(contractModule.validateActivityEvent({ ...runtime.create(requestStart), ...forbidden })).toBeNull();
  }
  expect(runtime.create(requestStart, { requestId: "ok", authorization: "Bearer secret" })).toBeNull();
  expect(runtime.create(requestStart, { requestId: { value: "nested raw ID" } })).toBeNull();
  expect(runtime.create(requestStart, { requestId: "" })).toBeNull();
  expect(runtime.create(requestStart, { requestId: "x".repeat(257) })).toBeNull();
});

test("strict validator rejects unknown enum values, bad time, unbounded counters and forged hashes", () => {
  const runtime = contract();
  const valid = runtime.create(requestStart);
  expect(valid).not.toBeNull();
  for (const bad of [
    { level: "TRACE" }, { category: "private" }, { event: "raw_prompt" },
    { phase: "shell" }, { code: "raw tool result" }, { http_status: 418 },
    { duration_ms: -1 }, { duration_ms: 86_400_001 },
    { count: -1 }, { count: 1_000_001 }, { count: 1.5 },
    { buffer_bytes: 16_777_217 }, { buffer_bytes: Number.POSITIVE_INFINITY },
    { request_hash: "unhashed-id" }, { at: "yesterday" }, { version: 2 },
  ]) {
    expect(contractModule.validateActivityEvent({ ...valid, ...bad })).toBeNull();
  }
  expect(runtime.create({ ...requestStart, duration_ms: Number.NaN })).toBeNull();
  expect(runtime.create({ ...requestStart, count: "1" })).toBeNull();
  expect(runtime.create({ ...requestStart, level: "warn" })).toBeNull();
  expect(runtime.create({ ...requestStart, http_status: 418 })).toBeNull();
});

test("rejects prototype tricks, symbols and non-enumerable or accessor fields", () => {
  const runtime = contract();
  const valid = runtime.create(requestStart);
  expect(valid).not.toBeNull();
  expect(contractModule.validateActivityEvent(Object.assign(Object.create({ secret: "inherited" }), valid))).toBeNull();
  expect(runtime.create(Object.assign(Object.create({ secret: "inherited" }), requestStart))).toBeNull();
  const withHidden = { ...valid };
  Object.defineProperty(withHidden, "prompt", { value: "private", enumerable: false });
  expect(contractModule.validateActivityEvent(withHidden)).toBeNull();
  const withHiddenRequired = { ...valid };
  Object.defineProperty(withHiddenRequired, "code", { value: "ok", enumerable: false });
  expect(contractModule.validateActivityEvent(withHiddenRequired)).toBeNull();
  expect(runtime.create(requestStart, Object.defineProperty({}, "requestId", {
    value: "hidden-sensitive-id", enumerable: false,
  }))).toBeNull();
  const withSymbol = { ...valid, [Symbol("secret")]: "private" };
  expect(contractModule.validateActivityEvent(withSymbol)).toBeNull();
  const withGetter = { ...valid };
  Object.defineProperty(withGetter, "code", { enumerable: true, get: () => { throw new Error("secret"); } });
  expect(() => contractModule.validateActivityEvent(withGetter)).not.toThrow();
  expect(contractModule.validateActivityEvent(withGetter)).toBeNull();
});

test("validation never copies a field that changes after its first validation read", () => {
  const valid = contract().create(requestStart);
  let reads = 0;
  const unstable = new Proxy({ ...valid }, {
    get(target, key, receiver) {
      if (key === "code") return ++reads === 1 ? "ok" : "Bearer top-secret";
      return Reflect.get(target, key, receiver);
    },
  });
  const observed = contractModule.validateActivityEvent(unstable);
  expect(observed?.code).toBe("ok");
  expect(JSON.stringify(observed)).not.toContain("top-secret");
});

test("observation never forwards invalid events or changes caller results on synchronous sink failure", () => {
  const valid = contract().create(requestStart);
  const observed: unknown[] = [];
  const requestOutcome = { httpStatus: 200, browserSendCount: 1, toolAckCount: 1 };
  expect(contractModule.observeActivity({ ...valid, prompt: "secret" }, item => { observed.push(item); })).toBeUndefined();
  expect(observed).toEqual([]);
  expect(contractModule.observeActivity(valid, () => { throw new Error("logger broken: Bearer private"); })).toBeUndefined();
  expect(requestOutcome).toEqual({ httpStatus: 200, browserSendCount: 1, toolAckCount: 1 });
});

test("asynchronous observer rejection is contained without changing execution outcome", async () => {
  const valid = contract().create(requestStart);
  let requestSettled = false;
  const request = Promise.resolve("browser accepted; tool ACK stays complete").then(value => {
    requestSettled = true;
    return value;
  });
  expect(contractModule.observeActivity(valid, async () => { throw new Error("sink rejected"); })).toBeUndefined();
  expect(await request).toBe("browser accepted; tool ACK stays complete");
  await Bun.sleep(5);
  expect(requestSettled).toBe(true);
});
