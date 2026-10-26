import { expect, test } from "bun:test";
import { defaultConfig } from "../src/config";
import type { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { AgentResponsesProvider } from "../src/integrations/agent-responses/routes";
import { startAgentResponsesListener } from "../src/integrations/agent-responses/listener";

const key = "synthetic-loopback-only-" + "k".repeat(48);
const model = "chatgpt-web/gpt-5.6-luna";

function reserveEphemeralPort(): number {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => new Response("reserved", { status: 200 }) });
  const port = reservation.port;
  reservation.stop(true);
  if (port === undefined) throw new Error("Bun did not report the reserved loopback port");
  if (port === 17_841) return reserveEphemeralPort();
  return port;
}

test("real separate 127.0.0.1 listener routes models and JSON/SSE; auth, Host, Origin and native admin stay isolated", async () => {
  let browserStarts = 0;
  const manager = {
    activeCount: () => 0, hasPendingCall: () => false, preflight: () => undefined,
    start: async () => { browserStarts++; return { text: "Synthetic HTTP answer", calls: [], finished: true }; },
    continue: async () => ({ text: "unused", calls: [], finished: true }), closeAll: () => undefined,
  };
  const provider = new AgentResponsesProvider({ ...defaultConfig("full"), browserInteractionMode: "automatic",
    solAvailable: false }, {} as TurnBroker, key, manager as never);
  const port = reserveEphemeralPort(); // Test-only dynamic port; no production default or port configuration chosen.
  const listener = startAgentResponsesListener({ provider, port });
  expect(listener.status).toBe("ready");
  expect(port).not.toBe(17_841);
  const base = `http://127.0.0.1:${port}`;
  const authorized = { authorization: `Bearer ${key}` };
  const post = (body: string, headers: Record<string, string> = {}) => fetch(`${base}/v1/responses`, {
    method: "POST", headers: { "content-type": "application/json", ...authorized, ...headers }, body,
  });
  try {
    const unauthenticated = await fetch(`${base}/v1/models`);
    expect(unauthenticated.status).toBe(401);
    const malformedUnauthenticated = await post("{invalid JSON", { authorization: "Bearer wrong" });
    expect(malformedUnauthenticated.status).toBe(401);
    const models = await fetch(`${base}/v1/models`, { headers: authorized });
    expect(models.status).toBe(200);
    const catalog = await models.json() as { data: Array<{ id: string }> };
    expect(catalog.data.map(row => row.id)).toContain(model);

    const poisonedHost = await fetch(`${base}/v1/models`, { headers: { ...authorized,
      host: `rebound.attacker:${port}` } });
    expect(poisonedHost.status).toBe(403);
    const browserOrigin = await fetch(`${base}/v1/models`, { headers: { ...authorized,
      origin: "https://attacker.example" } });
    expect(browserOrigin.status).toBe(403);
    const nullOrigin = await fetch(`${base}/v1/models`, { headers: { ...authorized, origin: "null" } });
    expect(nullOrigin.status).toBe(403);

    const prompt = JSON.stringify({ model, input: "Respond without launching a browser", stream: false });
    const json = await post(prompt);
    expect(json.status).toBe(200);
    expect(await json.text()).toContain("Synthetic HTTP answer");
    const sse = await post(JSON.stringify({ model, input: "Stream", stream: true }));
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const frames = await sse.text();
    expect(frames).toContain("event: response.output_text.delta");
    expect(frames.match(/event: response.completed/g)).toHaveLength(1);
    expect(frames).toContain("Synthetic HTTP answer");
    expect(browserStarts).toBe(2);

    const nativeAdmin = await fetch(`${base}/admin/shutdown`, { headers: authorized });
    expect(nativeAdmin.status).toBe(404);
  } finally {
    await listener.server?.stop(true);
    provider.close();
  }
  await expect(fetch(`${base}/v1/models`, { headers: authorized })).rejects.toThrow();
});
