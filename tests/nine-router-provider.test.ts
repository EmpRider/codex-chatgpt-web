import { afterAll, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defaultConfig, providerConfig } from "../src/config";
import { TurnBroker, callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { NineRouterProvider, canonicalNineRouterModel } from "../src/integrations/nine-router/routes";
import { NineRouterRequestError, parseNineRouterRequest } from "../src/integrations/nine-router/request";
import { NineRouterSessionManager } from "../src/integrations/nine-router/session-manager";
import { disableNineRouterKey, loadNineRouterKey, provisionNineRouterKey } from "../src/integrations/nine-router/key-manager";

const advertised = {
  type: "function", name: "Read", description: "Read an agent-side file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
};

test("9Router normalizer retains role order, schemas and tool results without constructing native Codex metadata", () => {
  const parsed = parseNineRouterRequest({
    model: "chatgpt-web/gpt-5.6-luna", instructions: "Be concise", stream: true,
    tools: [advertised],
    input: [
      { role: "system", content: "Project rules" },
      { role: "user", content: [{ type: "input_text", text: "Read file" }] },
      { type: "function_call", call_id: `call_${"a".repeat(32)}`, name: "Read", arguments: "{}" },
      { type: "function_call_output", call_id: `call_${"a".repeat(32)}`, output: "done" },
    ],
  });
  expect(parsed.history.slice(0, 2)).toEqual([{ role: "system", text: "Project rules" }, { role: "user", text: "Read file" }]);
  expect(parsed.history[2]).toMatchObject({ role: "assistant" });
  expect(parsed.history[3]).toMatchObject({ role: "tool", text: expect.stringContaining("done") });
  expect(parsed.outputs).toEqual([{ callId: `call_${"a".repeat(32)}`, output: "done" }]);
  expect(parsed.tools[0]).toMatchObject({ name: "Read", parameters: advertised.parameters });
  expect(JSON.stringify(parsed)).not.toContain("sandboxPolicy");
});

test("9Router's pinned unmodified Claude→Responses translator fixtures parse losslessly", () => {
  const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/nine-router/${name}.responses.json`, import.meta.url), "utf8"));
  const original = parseNineRouterRequest(fixture("claude-start"));
  const continuation = parseNineRouterRequest(fixture("claude-continuation"));
  expect(continuation.history.slice(0, original.history.length)).toEqual(original.history);
  expect(continuation.history[1]?.role).toBe("assistant");
  expect(continuation.history[2]?.role).toBe("tool");
  expect(original.instructions).toBe("Be helpful");
  expect(continuation.tools).toEqual(original.tools);
  expect(continuation.outputs).toEqual([{
    callId: "call_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdef", output: "export default 42",
  }]);
});

test("9Router model prefix is stripped at most once and cannot silently select a different backend", () => {
  expect(canonicalNineRouterModel("chatgpt-web/gpt-5.6-luna")).toBe("chatgpt-web/gpt-5.6-luna");
  expect(canonicalNineRouterModel("ccw/chatgpt-web/gpt-5.6-luna")).toBe("chatgpt-web/gpt-5.6-luna");
  expect(() => canonicalNineRouterModel("ccw/other/gpt-5.6-luna")).toThrow("Expected a ChatGPT Web");
  expect(() => canonicalNineRouterModel("first/second/chatgpt-web/gpt-5.6-luna")).toThrow("Expected a ChatGPT Web");
});

test("9Router request rejects unknown control items, duplicate tool names and oversize inventories", () => {
  const minimal = { model: "chatgpt-web/gpt-5.6-luna", input: [{ role: "user", content: "hi" }] };
  expect(() => parseNineRouterRequest({ ...minimal, input: [{ type: "opaque_claim", value: "danger" }] })).toThrow(NineRouterRequestError);
  expect(() => parseNineRouterRequest({ ...minimal, tools: [advertised, advertised] })).toThrow("Duplicate tool");
  expect(() => parseNineRouterRequest({ ...minimal, tools: Array(257).fill(advertised) })).toThrow("up to 256");
  expect(parseNineRouterRequest({ model: minimal.model, input: "plain prompt" }).history).toEqual([{ role: "user", text: "plain prompt" }]);
  expect(() => parseNineRouterRequest({ ...minimal, input: [{ role: "user", content: [{ type: "input_image", image_url: "https://example.org/image" }] }] })).toThrow("Unsupported multimodal");
});

test("integration keys are independently generated, rotated and recoverably disabled outside Git", () => {
  const keyDir = mkdtempSync(join(tmpdir(), "cgw-9router-key-"));
  try {
    expect(loadNineRouterKey(keyDir)).toBeUndefined();
    const path = provisionNineRouterKey("create", keyDir);
    expect(path).toContain("nine-router-key.json");
    const before = loadNineRouterKey(keyDir);
    expect(before?.length).toBeGreaterThanOrEqual(32);
    expect(() => provisionNineRouterKey("create", keyDir)).toThrow("already exists");
    provisionNineRouterKey("rotate", keyDir);
    const after = loadNineRouterKey(keyDir);
    expect(after).not.toBe(before);
    expect(disableNineRouterKey(keyDir)).toContain("disabled-");
    expect(loadNineRouterKey(keyDir)).toBeUndefined();
  } finally { rmSync(keyDir, { recursive: true, force: true }); }
});

test("a no-tool 9Router request reaches the isolated browser runner and returns a terminal stage", async () => {
  const config = defaultConfig("full");
  config.solAvailable = false;
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    async run(turn) {
      const request = await turn.prepare();
      expect(request.text).toContain("no agent tools were supplied");
      turn.onTextDelta("Hello from Web");
      return "Hello from Web";
    },
  });
  try {
    const stage = await manager.start(parseNineRouterRequest({
      model: "chatgpt-web/gpt-5.6-luna", input: "Hello",
    }), { backendModel: "gpt-5.6-luna", adapterEffort: "low" });
    expect(stage).toEqual({ text: "Hello from Web", calls: [], finished: true });
  } finally { manager.closeAll(); }
});

const root = mkdtempSync(join(tmpdir(), "cgw-9router-"));
const broker = TurnBroker.forSocket(join(root, "broker.sock"));
afterAll(async () => { await broker.close(); rmSync(root, { recursive: true, force: true }); });

test("dedicated 9Router endpoint is disabled by default, authenticated and exposes only Web models", async () => {
  const config = defaultConfig("full");
  config.browserInteractionMode = "automatic";
  config.solAvailable = false;
  const apiKey = "test-only_" + "x".repeat(40);
  const provider = new NineRouterProvider(config, broker, apiKey);
  const path = "/integrations/9router/v1/models";
  expect((await provider.handle(new Request("http://127.0.0.1" + path), path)).status).toBe(401);
  const response = await provider.handle(new Request("http://127.0.0.1" + path, {
    headers: { authorization: `Bearer ${apiKey}` },
  }), path);
  expect(response.status).toBe(200);
  const catalog = await response.json() as { data: Array<{ id: string }> };
  expect(catalog.data.map(model => model.id)).toContain("chatgpt-web/gpt-5.6-luna");
  expect(catalog.data.some(model => !model.id.startsWith("chatgpt-web/"))).toBe(false);
  expect((await provider.handle(new Request("http://127.0.0.1" + path, {
    headers: { authorization: `Bearer ${apiKey}` },
  }), path, true)).status).toBe(503);
  provider.close();
});

test("authenticated provider Responses route emits standard SSE and nonstream JSON", async () => {
  const config = defaultConfig("full");
  config.solAvailable = false;
  config.browserInteractionMode = "automatic";
  const apiKey = "test-only_" + "s".repeat(40);
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    async run(turn) { turn.onTextDelta("Hello from 9Router"); return "Hello from 9Router"; },
  });
  const provider = new NineRouterProvider(config, broker, apiKey, manager);
  const path = "/integrations/9router/v1/responses";
  const send = (stream: boolean) => provider.handle(new Request(`http://127.0.0.1${path}`, {
    method: "POST", headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
    body: JSON.stringify({ model: "chatgpt-web/gpt-5.6-luna", stream, input: "Hello" }),
  }), path);
  try {
    const sse = await send(true);
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const frames = await sse.text();
    expect(frames).toContain("event: response.output_text.delta");
    expect(frames).toContain("Hello from 9Router");
    expect(frames).toContain("event: response.completed");
    const json = await (await send(false)).json() as { output: Array<{ type: string; content?: Array<{ text: string }> }> };
    expect(json.output.find(item => item.type === "message")?.content?.[0]?.text).toBe("Hello from 9Router");
  } finally { provider.close(); }
});

test("invalid provider media type and malformed JSON fail before starting a browser turn", async () => {
  const config = defaultConfig("full");
  config.solAvailable = false;
  const apiKey = "test-only_" + "p".repeat(40);
  const provider = new NineRouterProvider(config, broker, apiKey);
  const path = "/integrations/9router/v1/responses";
  const send = (body: string, contentType: string) => provider.handle(new Request(`http://127.0.0.1${path}`, {
    method: "POST", body, headers: { authorization: `Bearer ${apiKey}`, "content-type": contentType },
  }), path);
  try {
    expect((await send("{}", "text/plain")).status).toBe(415);
    expect((await send("{", "application/json")).status).toBe(400);
    expect(provider.activeCount).toBe(0);
  } finally { provider.close(); }
});

test("a later user turn treats old 9Router tool outputs as history, without reopening the retired call", async () => {
  const config = defaultConfig("full");
  config.solAvailable = false;
  const key = "test-only_" + "h".repeat(40);
  let capturedPrompt = "";
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    async run(turn) {
      capturedPrompt = (await turn.prepare()).text;
      turn.onTextDelta("Next task answered");
      return "Next task answered";
    },
  });
  const provider = new NineRouterProvider(config, broker, key, manager);
  const path = "/integrations/9router/v1/responses";
  try {
    const response = await provider.handle(new Request(`http://127.0.0.1${path}`, {
      method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({
        model: "chatgpt-web/gpt-5.6-luna", stream: false,
        input: [
          { role: "user", content: "Earlier task" },
          { type: "function_call", call_id: `call_${"a".repeat(32)}`, name: "Read", arguments: "{}" },
          { type: "function_call_output", call_id: `call_${"a".repeat(32)}`, output: "Previous output" },
          { role: "user", content: "Next task" },
        ],
      }),
    }), path);
    expect(response.status).toBe(200);
    expect(capturedPrompt).toContain("Previous output");
    expect(capturedPrompt).toContain("Next task");
    const json = await response.json() as { output: Array<{ content?: Array<{ text?: string }> }> };
    expect(json.output[0]?.content?.[0]?.text).toBe("Next task answered");
  } finally { provider.close(); }
});

test("disconnect before any tool delivery revokes the external browser and broker owner", async () => {
  const config = defaultConfig("full");
  config.solAvailable = false;
  let aborted = false;
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    run(turn) {
      return new Promise<string>((_, reject) => {
        turn.abortSignal!.addEventListener("abort", () => {
          aborted = true; reject(new Error("cancelled by HTTP observer"));
        }, { once: true });
      });
    },
  });
  const controller = new AbortController();
  const pending = manager.start(parseNineRouterRequest({
    model: "chatgpt-web/gpt-5.6-luna", input: "long task", tools: [advertised],
  }), { backendModel: "gpt-5.6-luna", adapterEffort: "low" }, controller.signal);
  await new Promise(resolve => setTimeout(resolve, 10));
  controller.abort();
  await expect(pending).rejects.toThrow();
  expect(aborted).toBe(true);
  expect(manager.activeCount()).toBe(0);
  manager.closeAll();
});

test("external agent tool call survives a genuine broker round-trip, then resumes the browser owner", async () => {
  const config = defaultConfig("full");
  config.solAvailable = false;
  let sawAgentEnvironment = false;
  let sawToolResult = false;
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    async run(turn) {
      const prompt = await turn.prepare();
      const token = prompt.turnToken!;
      expect(prompt.text).toContain("coding agent request delivered through 9Router");
      const claimed = await callTurnBroker<{ bindingId: string; environment: Record<string, unknown>; activityId: string }>(
        broker.socketPath, { method: "claim", token }, 5_000,
      );
      sawAgentEnvironment = claimed.environment.kind === "external-agent"
        && !Object.hasOwn(claimed.environment, "cwd") && !Object.hasOwn(claimed.environment, "sandboxPolicy");
      await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claimed.activityId });
      const resultPromise = callTurnBroker<{ content: Array<{ type: string; text: string }> }>(broker.socketPath, {
        method: "invoke", bindingId: claimed.bindingId, wireName: "Read", freeform: false, arguments: { path: "main.ts" },
      }, null);
      const progress = turn.externalProgress!;
      let revision = progress.snapshot().lastToolBatchRevision;
      while (revision === 0) {
        await progress.waitForChange(progress.snapshot().revision);
        revision = progress.snapshot().lastToolBatchRevision;
      }
      await progress.acknowledgeToolBatch(revision);
      const result = await resultPromise;
      sawToolResult = result.content[0]?.text === "export default 42";
      turn.onTextDelta("Finished reading main.ts");
      return "Finished reading main.ts";
    },
  });
  try {
    const request = parseNineRouterRequest({
      model: "chatgpt-web/gpt-5.6-luna", tools: [advertised],
      input: [{ role: "user", content: "Read main.ts" }],
    });
    const first = await manager.start(request, { backendModel: "gpt-5.6-luna", adapterEffort: "low" });
    expect(first.calls).toHaveLength(1);
    expect(first.calls[0]).toMatchObject({ wireName: "Read", arguments: { path: "main.ts" } });
    expect(first.finished).toBe(false);
    await expect(manager.continue(parseNineRouterRequest({
      model: request.model,
      input: [{ role: "user", content: "Read main.ts" }, { type: "function_call_output", call_id: `call_${"x".repeat(32)}`, output: "intrusion" }],
    }))).rejects.toThrow("No unambiguous");
    await expect(manager.continue(parseNineRouterRequest({
      model: request.model,
      input: [{ role: "user", content: "Unrelated thread" }, { type: "function_call_output", call_id: first.calls[0]!.callId, output: "intrusion" }],
    }))).rejects.toThrow("original conversation history");
    const second = await manager.continue(parseNineRouterRequest({
      model: request.model,
      input: [{ role: "user", content: "Read main.ts" }, { type: "function_call_output", call_id: first.calls[0]!.callId, output: "export default 42" }],
    }));
    expect(second).toEqual({ text: "Finished reading main.ts", calls: [], finished: true });
    expect(sawAgentEnvironment).toBe(true);
    expect(sawToolResult).toBe(true);
    expect(manager.activeCount()).toBe(0);
  } finally {
    manager.closeAll();
  }
});

test("parallel broker calls require all tool outputs and preserve per-call ordering", async () => {
  const config = defaultConfig("full");
  config.solAvailable = false;
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    async run(turn) {
      const token = (await turn.prepare()).turnToken!;
      const claimed = await callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath, { method: "claim", token });
      await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claimed.activityId });
      const calls = ["first.ts", "second.ts"].map(path => callTurnBroker<{ content: Array<{ text: string }> }>(broker.socketPath, {
        method: "invoke", bindingId: claimed.bindingId, wireName: "Read", freeform: false, arguments: { path },
      }, null));
      const progress = turn.externalProgress!;
      let revision = progress.snapshot().lastToolBatchRevision;
      while (revision === 0) {
        await progress.waitForChange(progress.snapshot().revision);
        revision = progress.snapshot().lastToolBatchRevision;
      }
      await progress.acknowledgeToolBatch(revision);
      const results = await Promise.all(calls);
      expect(results.map(result => result.content[0]?.text)).toEqual(["first content", "second content"]);
      turn.onTextDelta("Read both files");
      return "Read both files";
    },
  });
  try {
    const request = parseNineRouterRequest({ model: "chatgpt-web/gpt-5.6-luna", tools: [advertised], input: "Read two files" });
    const first = await manager.start(request, { backendModel: "gpt-5.6-luna", adapterEffort: "low" });
    expect(first.calls).toHaveLength(2);
    const baseInput = [{ role: "user", content: "Read two files" }];
    await expect(manager.continue(parseNineRouterRequest({ model: request.model,
      input: [...baseInput, { type: "function_call_output", call_id: first.calls[1]!.callId, output: "second content" }],
    }))).rejects.toThrow("All outstanding tool results");
    await expect(manager.continue(parseNineRouterRequest({ model: request.model,
      input: [
        ...baseInput,
        { type: "function_call_output", call_id: first.calls[0]!.callId, output: "first content" },
        { type: "function_call_output", call_id: first.calls[1]!.callId, output: "[No response received]" },
      ],
    }))).rejects.toThrow("fabricated execution");
    const second = await manager.continue(parseNineRouterRequest({ model: request.model,
      input: [
        ...baseInput,
        { type: "function_call_output", call_id: first.calls[1]!.callId, output: "second content" },
        { type: "function_call_output", call_id: first.calls[0]!.callId, output: "first content" },
      ],
    }));
    expect(second).toEqual({ text: "Read both files", calls: [], finished: true });
  } finally { manager.closeAll(); }
});
