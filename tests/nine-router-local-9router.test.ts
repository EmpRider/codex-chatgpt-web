import { expect, test } from "bun:test";
import { createHash, randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { defaultConfig, providerConfig } from "../src/config";
import { TurnBroker, callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { NineRouterSessionManager } from "../src/integrations/nine-router/session-manager";
import { NineRouterProvider } from "../src/integrations/nine-router/routes";

// Opt-in: must point to a *fresh isolated* unmodified 9Router installation.
// Never run this against the user's real 9Router database or API key.
const nineRouterUrl = process.env.CODEX_9ROUTER_E2E_URL;
const isolatedData = process.env.CODEX_9ROUTER_E2E_DATA_DIR;
const explicitlyIsolated = !!nineRouterUrl && /^http:\/\/127\.0\.0\.1:\d+$/.test(nineRouterUrl)
  && !!isolatedData && /^\/tmp\/cgw-9router-e2e-[A-Za-z0-9]+$/.test(resolve(isolatedData));

test.skipIf(!explicitlyIsolated)("unmodified local 9Router relays Claude Messages function use/result through this fork", async () => {
  const base = nineRouterUrl!;
  // This is the default password of a newly created disposable local profile.
  // The test never reads, modifies or logs any user's normal 9Router credentials.
  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: "123456" }),
  });
  expect(login.status).toBe(200);
  const cookie = login.headers.get("set-cookie")?.split(";")[0];
  expect(cookie).toBeTruthy();
  const configure = async (path: string, body: unknown) => {
    const response = await fetch(`${base}${path}`, { method: "POST",
      headers: { "content-type": "application/json", cookie: cookie! }, body: JSON.stringify(body) });
    const result = await response.json() as Record<string, unknown>;
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(300);
    return result;
  };
  const broker = TurnBroker.forSocket(`/tmp/cgw-r9-${createHash("sha256").update(isolatedData!).digest("hex").slice(0, 15)}.sock`);
  const config = defaultConfig("full");
  config.solAvailable = false;
  const tool = { type: "function", name: "Read", description: "Simulated agent-side Read",
    parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } };
  let browserRuns = 0;
  const manager = new NineRouterSessionManager(broker, providerConfig(config), {
    async run(turn) {
      browserRuns++;
      const prepared = await turn.prepare();
      if (!turn.nativeConnector) return "9Router direct Responses text works";
      const token = prepared.turnToken!;
      const claim = await callTurnBroker<{ bindingId: string; activityId: string }>(broker.socketPath,
        { method: "claim", token });
      await callTurnBroker(broker.socketPath, { method: "activity_complete", token, activityId: claim.activityId });
      const invocation = callTurnBroker<{ content: Array<{ text?: string }> }>(broker.socketPath,
        { method: "invoke", bindingId: claim.bindingId, wireName: "Read", freeform: false,
          arguments: { path: "project/test.ts" } }, null);
      const progress = turn.externalProgress!;
      while (!progress.snapshot().lastToolBatchRevision) {
        await progress.waitForChange(progress.snapshot().revision);
      }
      await progress.acknowledgeToolBatch(progress.snapshot().lastToolBatchRevision);
      const answer = await invocation;
      return `9Router tool continuation received ${answer.content[0]?.text}`;
    },
  });
  const providerKey = "offline_9router_" + "G".repeat(42);
  const prefix = `r9${randomUUID().slice(0, 8)}`;
  const provider = new NineRouterProvider(config, broker, providerKey, manager);
  const forkServer = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch(request) { return provider.handle(request, new URL(request.url).pathname); } });
  try {
    const nodeResult = await configure("/api/provider-nodes", {
      name: "Isolated Fork Contract Test", prefix, apiType: "responses",
      baseUrl: `http://127.0.0.1:${forkServer.port}/integrations/9router/v1`, type: "openai-compatible",
    });
    const node = nodeResult.node as { id: string };
    expect(node.id).toBeTruthy();
    await configure("/api/providers", { provider: node.id, name: "Disposable Fork Key", apiKey: providerKey });
    await configure("/api/models/custom", { providerAlias: prefix, id: "chatgpt-web/gpt-5.6-luna", type: "llm" });
    const credential = await configure("/api/keys", { name: "Disposable Test Agent" });
    const gatewayKey = credential.key as string;
    expect(gatewayKey.length).toBeGreaterThan(10);

    const discovery = await fetch(`${base}/v1/models`, {
      headers: { authorization: `Bearer ${gatewayKey}` },
    });
    expect(discovery.status).toBe(200);
    const catalog = await discovery.json() as { data?: Array<{ id: string }> };
    expect(catalog.data?.map(item => item.id)).toContain(`${prefix}/chatgpt-web/gpt-5.6-luna`);

    const direct = await fetch(`${base}/v1/responses`, { method: "POST",
      headers: { authorization: `Bearer ${gatewayKey}`, "content-type": "application/json" },
      body: JSON.stringify({ model: `${prefix}/chatgpt-web/gpt-5.6-luna`, stream: true,
        input: [{ role: "user", content: "Ping Responses" }] }),
    });
    const directBody = await direct.text();
    expect(direct.status).toBe(200);
    expect(directBody).toContain("9Router direct Responses text works");

    const directTool = async (input: unknown) => {
      const result = await fetch(`${base}/v1/responses`, { method: "POST",
        headers: { authorization: `Bearer ${gatewayKey}`, "content-type": "application/json" },
        body: JSON.stringify({ model: `${prefix}/chatgpt-web/gpt-5.6-luna`, stream: true,
          tools: [tool], input }),
      });
      return { status: result.status, body: await result.text() };
    };
    const openAiFirst = await directTool([{ role: "user", content: "Read a file via standard OpenAI Responses" }]);
    expect(openAiFirst.status).toBe(200);
    const openAiCallId = openAiFirst.body.match(/"call_id":"(call_[A-Za-z0-9_-]+)"/)?.[1];
    expect(openAiCallId).toBeTruthy();
    expect(openAiFirst.body).toContain('"name":"Read"');
    const openAiDone = await directTool([
      { role: "user", content: "Read a file via standard OpenAI Responses" },
      { type: "function_call", call_id: openAiCallId, name: "Read", arguments: '{"path":"project/test.ts"}' },
      { type: "function_call_output", call_id: openAiCallId, output: "OpenAI agent return payload" },
    ]);
    expect(openAiDone.status).toBe(200);
    expect(openAiDone.body).toContain("9Router tool continuation received OpenAI agent return payload");

    const claude = async (messages: unknown[]) => {
      const result = await fetch(`${base}/v1/messages`, { method: "POST",
        headers: { "x-api-key": gatewayKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({ model: `${prefix}/chatgpt-web/gpt-5.6-luna`, max_tokens: 1000,
          stream: true, tools: [tool], messages }),
      });
      return { status: result.status, body: await result.text() };
    };
    const initial = await claude([{ role: "user", content: "Read project/test.ts" }]);
    expect(initial.status).toBe(200);
    // A Claude tool_use must preserve the same opaque call id that the fork emitted.
    const toolId = initial.body.match(/"id":"(call_[A-Za-z0-9_-]+)"/)?.[1];
    expect(toolId).toBeTruthy();
    expect(initial.body).toContain('"name":"Read"');
    const next = await claude([
      { role: "user", content: "Read project/test.ts" },
      { role: "assistant", content: [{ type: "tool_use", id: toolId, name: "Read", input: { path: "project/test.ts" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: toolId, content: "export const success = true" }] },
    ]);
    expect(next.status).toBe(200);
    expect(next.body).toContain("9Router tool continuation received export const success = true");
    expect(browserRuns).toBe(3); // direct text, OpenAI tool owner, Claude tool owner
    expect(manager.activeCount()).toBe(0);
  } finally {
    provider.close();
    await forkServer.stop(true);
    await broker.close();
  }
}, 30_000);
