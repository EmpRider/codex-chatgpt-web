import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import type { AppConfig } from "../src/config";
import type { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { AgentResponsesRequestError } from "../src/integrations/agent-responses/request";

// These modules deliberately do not exist at initial RED. Dynamic loading keeps
// missing public boundaries as assertion failures, not a test-runner import error.
const routesPath = "../src/integrations/agent-responses/routes";
const listenerPath = "../src/integrations/agent-responses/listener";

interface Gateway {
  handle(request: Request, path: string, draining?: boolean | (() => boolean)): Promise<Response>;
  close(): void;
  readonly enabled: boolean;
}
interface GatewayConstructor {
  new(config: AppConfig, broker: TurnBroker, key?: string, manager?: unknown, journal?: unknown): Gateway;
}
type Listener = { status: "disabled" | "ready" | "bind_failed"; server?: { stop(force?: boolean): unknown } };
type ListenerFactory = (options: {
  port?: number;
  provider: Gateway;
  isDraining?: () => boolean;
  serve?: (options: { hostname: string; port: number; fetch(request: Request): Response | Promise<Response> }) => {
    stop(force?: boolean): unknown;
  };
}) => Listener;

async function gatewayConstructor(): Promise<GatewayConstructor> {
  const module = await import(routesPath).catch(() => null) as { AgentResponsesProvider?: GatewayConstructor } | null;
  expect(typeof module?.AgentResponsesProvider).toBe("function");
  return module!.AgentResponsesProvider!;
}

async function listenerFactory(): Promise<ListenerFactory> {
  const module = await import(listenerPath).catch(() => null) as { startAgentResponsesListener?: ListenerFactory } | null;
  expect(typeof module?.startAgentResponsesListener).toBe("function");
  return module!.startAgentResponsesListener!;
}

const model = "chatgpt-web/gpt-5.6-luna";
const bearer = "fixture-only-" + "k".repeat(48);
const endpoint = "http://127.0.0.1:23487";
const config = (): AppConfig => ({ ...defaultConfig("full"), browserInteractionMode: "automatic",
  solAvailable: false });

function fakeManager(stage: { text: string; calls: unknown[]; finished: boolean } = {
  text: "Gateway answer", calls: [], finished: true,
}) {
  let starts = 0;
  return {
    get starts() { return starts; },
    activeCount: () => 0,
    hasPendingCall: () => false,
    preflight: () => undefined,
    start: async () => { starts++; return stage; },
    continue: async () => stage,
    closeAll: () => undefined,
  };
}

function get(path: string, token?: string, headers: Record<string, string> = {}): Request {
  return new Request(endpoint + path, { headers: {
    ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
  } });
}

function post(body: BodyInit, token?: string, headers: Record<string, string> = {}): Request {
  return new Request(endpoint + "/v1/responses", { method: "POST", headers: {
    "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}), ...headers,
  }, body, duplex: "half" } as RequestInit & { duplex: "half" });
}

test("generic /v1/models stays disabled without an operator-provisioned key, then requires its own bearer", async () => {
  const Provider = await gatewayConstructor();
  const disabled = new Provider(config(), {} as TurnBroker, undefined, fakeManager());
  expect(disabled.enabled).toBe(false);
  expect((await disabled.handle(get("/v1/models"), "/v1/models")).status).toBe(404);
  disabled.close();

  const provider = new Provider(config(), {} as TurnBroker, bearer, fakeManager());
  try {
    expect((await provider.handle(get("/v1/models"), "/v1/models")).status).toBe(401);
    const catalog = await provider.handle(get("/v1/models", bearer), "/v1/models");
    expect(catalog.status).toBe(200);
    const json = await catalog.json() as { object: string; data: Array<{ id: string }> };
    expect(json.object).toBe("list");
    expect(json.data.map(row => row.id)).toContain(model);
    expect(JSON.stringify(json)).not.toContain("9Router");
  } finally { provider.close(); }
});

test("wrong bearer is rejected before even reading a streaming JSON body; no native route fallback", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  let pulls = 0;
  const body = new ReadableStream<Uint8Array>({ pull(controller) {
    pulls++;
    controller.enqueue(new TextEncoder().encode("{invalid JSON"));
    controller.close();
  } }, { highWaterMark: 0 });
  try {
    const result = await provider.handle(post(body, "wrong-token"), "/v1/responses");
    expect(result.status).toBe(401);
    expect((await result.json() as { error: { type: string } }).error.type).toBe("authentication_error");
    expect(pulls).toBe(0);
    expect(manager.starts).toBe(0);
    expect((await provider.handle(get("/v1/responses", "wrong-token"), "/v1/responses")).status).toBe(401);
  } finally { provider.close(); }
});

test("valid bearer serves OpenAI Responses JSON and terminal SSE on generic paths", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  const send = (stream: boolean) => provider.handle(post(JSON.stringify({ model, input: "Say hello", stream }), bearer),
    "/v1/responses");
  try {
    const json = await send(false);
    expect(json.status).toBe(200);
    const body = await json.json() as { object: string; output: Array<{ type: string; content?: Array<{ text: string }> }> };
    expect(body.object).toBe("response");
    expect(body.output.find(row => row.type === "message")?.content?.[0]?.text).toBe("Gateway answer");

    const sse = await send(true);
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const frames = await sse.text();
    expect(frames).toContain("event: response.output_text.delta");
    expect(frames).toContain("Gateway answer");
    expect(frames.match(/event: response.completed/g)).toHaveLength(1);
    expect(frames).not.toContain("response.failed");
    expect(manager.starts).toBe(2);
  } finally { provider.close(); }
});

test("9Router model check accepts a translated max_output_tokens budget over Responses SSE", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager({ text: "hi", calls: [], finished: true });
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  try {
    const response = await provider.handle(post(JSON.stringify({
      model, instructions: "", stream: true, store: false, max_output_tokens: 1024,
      input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    }), bearer), "/v1/responses");
    expect(response.status).toBe(200);
    const events = await response.text();
    expect(events).toContain("response.output_text.delta");
    expect(events).toContain("response.completed");
    expect(events).not.toContain("response.failed");
    expect(manager.starts).toBe(1);
  } finally { provider.close(); }
});

test("Responses reasoning selects real model effort and rejects unsupported modes before Send", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  const efforts: string[] = [];
  manager.start = async (...args: unknown[]) => {
    efforts.push((args[1] as { adapterEffort: string }).adapterEffort);
    return { text: "hi", calls: [], finished: true };
  };
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  try {
    const accepted = await provider.handle(post(JSON.stringify({ model, input: "Hi", stream: true,
      reasoning_effort: "medium" }), bearer), "/v1/responses");
    expect(accepted.status).toBe(200);
    expect(await accepted.text()).toContain("response.completed");
    expect(efforts).toEqual(["medium"]);

    const denied = await provider.handle(post(JSON.stringify({ model, input: "Hi",
      reasoning_effort: "max" }), bearer), "/v1/responses");
    expect(denied.status).toBe(422);
    expect((await denied.json() as { error: { message: string } }).error.message)
      .toContain('Reasoning effort "max" is unavailable');
    expect(efforts).toEqual(["medium"]);
  } finally { provider.close(); }
});

test("GPT-6 Sol routes requested High and reports Max as unavailable without browser Send", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  const efforts: string[] = [];
  manager.start = async (...args: unknown[]) => {
    efforts.push((args[1] as { adapterEffort: string }).adapterEffort);
    return { text: "hi", calls: [], finished: true };
  };
  const provider = new Provider({ ...config(), solAvailable: true }, {} as TurnBroker, bearer, manager);
  const sol = "chatgpt-web/gpt-6-sol";
  try {
    const accepted = await provider.handle(post(JSON.stringify({ model: sol, input: "Hi",
      reasoning: { effort: "medium" } }), bearer), "/v1/responses");
    expect(accepted.status).toBe(200);
    expect(efforts).toEqual(["medium"]);
    const rejected = await provider.handle(post(JSON.stringify({ model: sol, input: "Hi",
      reasoning_effort: "max" }), bearer), "/v1/responses");
    expect(rejected.status).toBe(422);
    expect((await rejected.json() as { error: { message: string } }).error.message).toContain("medium, high");
    expect(efforts).toEqual(["medium"]);
  } finally { provider.close(); }
});

test("host, browser Origin, unknown route and untrusted tools cannot enter an external turn", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  try {
    for (const headers of <Array<Record<string, string>>>[{ host: "rebound.attacker:23487" }, { origin: "https://attacker.example" },
      { origin: "null" }, { origin: "http://rebound.attacker:23487" }]) {
      const response = await provider.handle(get("/v1/models", bearer, headers), "/v1/models");
      expect(response.status).toBe(403);
    }
    expect((await provider.handle(get("/admin/shutdown", bearer), "/admin/shutdown")).status).toBe(404);
    const reserved = await provider.handle(post(JSON.stringify({ model, input: "Run", tools: [{
      type: "function", name: "codex_exec", parameters: { type: "object" },
    }] }), bearer), "/v1/responses");
    expect(reserved.status).toBeGreaterThanOrEqual(400);
    expect(reserved.status).toBeLessThan(500);
    expect(manager.starts).toBe(0);
  } finally { provider.close(); }
});

test("journal duplicate is a 409 before a second browser Send", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  const claimed = new Set<string>();
  const journal = { claim: (key: string | null) => {
    if (!key) return undefined;
    if (claimed.has(key)) throw new AgentResponsesRequestError("Already attempted", 409);
    claimed.add(key);
    return { advance: () => undefined };
  } };
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager, journal);
  const request = () => post(JSON.stringify({ model, input: "Potential side effect" }), bearer,
    { "idempotency-key": "client-operation-unique-123" });
  try {
    expect((await provider.handle(request(), "/v1/responses")).status).toBe(200);
    const retry = await provider.handle(request(), "/v1/responses");
    expect(retry.status).toBe(409);
    expect(manager.starts).toBe(1);
  } finally { provider.close(); }
});

test("failure after SSE headers emits one terminal response.failed and no private exception", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  manager.start = async () => { throw new Error("private-account-and-broker-path: /secret/socket"); };
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  try {
    const response = await provider.handle(post(JSON.stringify({ model, input: "Hello", stream: true }), bearer),
      "/v1/responses");
    expect(response.status).toBe(200);
    const frames = await response.text();
    expect(frames.match(/event: response.failed/g)).toHaveLength(1);
    expect(frames).not.toContain("response.completed");
    expect(frames).not.toContain("private-account");
    expect(frames).not.toContain("/secret/socket");
  } finally { provider.close(); }
});

test("authenticated malformed JSON is a 400 client error, not a generic upstream 502", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  try {
    const malformed = await provider.handle(post("{bad", bearer), "/v1/responses");
    expect(malformed.status).toBe(400);
    const error = await malformed.json() as { error: { type: string; message: string } };
    expect(error.error.type).toBe("invalid_request_error");
    expect(error.error.message).not.toContain("{bad");
    expect(manager.starts).toBe(0);

    manager.start = async () => { throw new Error("internal browser transport secret"); };
    const failed = await provider.handle(post(JSON.stringify({ model, input: "Hello" }), bearer), "/v1/responses");
    expect(failed.status).toBe(502);
    expect((await failed.text())).not.toContain("transport secret");
  } finally { provider.close(); }
});

test("internal browser authentication failure never impersonates the generic API bearer error", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  manager.start = async () => { throw Object.assign(new Error("private ChatGPT session expired"), {
    status: 401, code: "chatgpt_session_expired",
  }); };
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  try {
    const response = await provider.handle(post(JSON.stringify({ model, input: "Hello" }), bearer), "/v1/responses");
    expect(response.status).toBe(502);
    const body = await response.json() as { error: { type: string; message: string } };
    expect(body.error.type).toBe("server_error");
    expect(body.error.message).not.toContain("ChatGPT");
    expect(body.error.message).not.toContain("expired");
  } finally { provider.close(); }
});

test("internal browser and tool-stage validation messages stay private in JSON and SSE", async () => {
  const Provider = await gatewayConstructor();
  const manager = fakeManager();
  manager.start = async () => {
    throw new AgentResponsesRequestError("ChatGPT browser and coding agent internal details", 422);
  };
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  try {
    for (const stream of [false, true]) {
      const response = await provider.handle(post(JSON.stringify({ model, input: "Hello", stream }), bearer),
        "/v1/responses");
      const body = await response.text();
      expect(body).not.toContain("ChatGPT browser");
      expect(body).not.toContain("coding agent");
      expect(body).toContain("Generic Responses request failed");
    }
  } finally { provider.close(); }
});

test("drain rechecks state after an already accepted slow request body arrives", async () => {
  const Provider = await gatewayConstructor();
  const start = await listenerFactory();
  const manager = fakeManager();
  const provider = new Provider(config(), {} as TurnBroker, bearer, manager);
  let releaseUpload!: () => void;
  let onRead!: () => void;
  const uploadWait = new Promise<void>(resolve => { releaseUpload = resolve; });
  const reading = new Promise<void>(resolve => { onRead = resolve; });
  const body = new ReadableStream<Uint8Array>({ async pull(controller) {
    onRead();
    await uploadWait;
    controller.enqueue(new TextEncoder().encode(JSON.stringify({ model, input: "Slow browser task" })));
    controller.close();
  } }, { highWaterMark: 0 });
  let draining = false;
  let fetchFromListener!: (request: Request) => Response | Promise<Response>;
  const listener = start({ provider, port: 23487, isDraining: () => draining, serve: options => {
    fetchFromListener = options.fetch;
    return { stop: () => undefined };
  } });
  try {
    expect(listener.status).toBe("ready");
    const pending = fetchFromListener(post(body, bearer));
    await reading;
    draining = true;
    releaseUpload();
    expect((await pending).status).toBe(503);
    expect(manager.starts).toBe(0);
  } finally { releaseUpload(); listener.server?.stop(); provider.close(); }
});

test("third concurrent authenticated upload receives generic 429 without a retired-provider diagnostic", async () => {
  const Provider = await gatewayConstructor();
  const provider = new Provider(config(), {} as TurnBroker, bearer, fakeManager());
  const began: Array<Promise<void>> = [];
  const release: Array<() => void> = [];
  const slowBody = (): ReadableStream<Uint8Array> => {
    let entered!: () => void;
    began.push(new Promise<void>(resolve => { entered = resolve; }));
    return new ReadableStream<Uint8Array>({ pull(controller) {
      entered();
      return new Promise<void>(resolve => { release.push(() => { controller.close(); resolve(); }); });
    } }, { highWaterMark: 0 });
  };
  const pending = [provider.handle(post(slowBody(), bearer), "/v1/responses"),
    provider.handle(post(slowBody(), bearer), "/v1/responses")];
  try {
    await Promise.all(began);
    const response = await provider.handle(post(JSON.stringify({ model, input: "Third" }), bearer), "/v1/responses");
    expect(response.status).toBe(429);
    const error = await response.json() as { error: { message: string; type: string } };
    expect(error.error.type).toBe("invalid_request_error");
    expect(error.error.message).not.toContain("9Router");
    expect(error.error.message).toContain("concurrent");
  } finally {
    release.forEach(finish => finish());
    await Promise.all(pending);
    provider.close();
  }
});

test("listener is disabled without an explicit port, refuses native port, isolates bind failure", async () => {
  const Provider = await gatewayConstructor();
  const start = await listenerFactory();
  const provider = new Provider(config(), {} as TurnBroker, bearer, fakeManager());
  let binds = 0;
  const serve = (_options: { hostname: string; port: number }) => { binds++; throw new Error("Address already in use"); };
  try {
    expect(start({ provider, serve }).status).toBe("disabled");
    expect(binds).toBe(0);
    expect(() => start({ provider, port: 17841, serve })).toThrow();
    expect(binds).toBe(0);
    const failed = start({ provider, port: 23487, serve });
    expect(failed.status).toBe("bind_failed");
    expect(binds).toBe(1);
    // A generic bind error is reported separately; the native listener is never passed to this API.
  } finally { provider.close(); }
});

test("enabled listener binds only 127.0.0.1 on the explicit generic port and dispatches no native admin route", async () => {
  const Provider = await gatewayConstructor();
  const start = await listenerFactory();
  const provider = new Provider(config(), {} as TurnBroker, bearer, fakeManager());
  let bound: { hostname: string; port: number; fetch(request: Request): Response | Promise<Response> } | undefined;
  let stopped = false;
  try {
    const listener = start({ provider, port: 23487, serve: options => {
      bound = options;
      return { stop: () => { stopped = true; } };
    } });
    expect(listener.status).toBe("ready");
    expect(bound).toMatchObject({ hostname: "127.0.0.1", port: 23487 });
    const modelResponse = await bound!.fetch(get("/v1/models", bearer));
    expect(modelResponse.status).toBe(200);
    const admin = await bound!.fetch(get("/admin/shutdown", bearer));
    expect(admin.status).toBe(404);
    listener.server?.stop();
    expect(stopped).toBe(true);
  } finally { provider.close(); }
});
