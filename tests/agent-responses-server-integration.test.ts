import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultConfig, loadConfig, saveConfig } from "../src/config";
import { agentResponsesKeyPath, provisionAgentResponsesKey } from "../src/integrations/agent-responses/key-manager";
import { startAgentResponsesListener } from "../src/integrations/agent-responses/listener";
import { AgentResponsesProvider } from "../src/integrations/agent-responses/routes";
import { startServer } from "../src/server";

// Startup composition is tested through both internal injection and the ordinary saved-config
// service path. Generic listening requires an explicit port and separate persisted bearer key.
type GenericServe = NonNullable<Parameters<typeof startAgentResponsesListener>[0]["serve"]>;
const genericKey = "synthetic-test-operator-" + "k".repeat(48);

function unusedLoopbackPort(excluded: number[] = []): number {
  const reservation = Bun.serve({ hostname: "127.0.0.1", port: 0,
    fetch: () => new Response("reserved") });
  const port = reservation.port;
  reservation.stop(true);
  if (port === undefined) throw new Error("Bun did not provide an ephemeral port");
  return port === 17_841 || excluded.includes(port) ? unusedLoopbackPort(excluded) : port;
}

function syntheticProvider(): AgentResponsesProvider {
  const manager = {
    activeCount: () => 0,
    hasPendingCall: () => false,
    preflight: () => undefined,
    start: async () => ({ text: "Synthetic composed answer", calls: [], finished: true }),
    continue: async () => ({ text: "unused", calls: [], finished: true }),
    closeAll: () => undefined,
  };
  return new AgentResponsesProvider({ ...defaultConfig("full"), browserInteractionMode: "automatic",
    solAvailable: false }, {} as TurnBroker, genericKey, manager as never);
}

const fakeNativeCatalog = async () => Response.json({ models: [{
  slug: "gpt-5.6-sol", display_name: "5.6 Sol", visibility: "list",
  supported_in_api: true, supported_reasoning_levels: [], tool_mode: "code_mode_only",
}] });

async function withIsolatedRuntimeConfig(run: (root: string) => Promise<void> | void): Promise<void> {
  const oldHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const oldGenericPort = process.env.CODEX_CHATGPT_WEB_AGENT_RESPONSES_PORT;
  const root = mkdtempSync(join(tmpdir(), "agent-responses-startup-"));
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  delete process.env.CODEX_CHATGPT_WEB_AGENT_RESPONSES_PORT;
  const config = { ...defaultConfig("full"),
    tunnel: {
      binaryPath: join(root, "synthetic-tunnel"), tunnelId: `tunnel_${"a".repeat(32)}`,
      runtimeKeyFile: join(root, "synthetic-runtime-key"), profileDir: join(root, "profile"),
      profileName: "synthetic", alias: "synthetic",
    },
  };
  saveConfig(config);
  try { await run(root); }
  finally {
    if (oldHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = oldHome;
    if (oldGenericPort === undefined) delete process.env.CODEX_CHATGPT_WEB_AGENT_RESPONSES_PORT;
    else process.env.CODEX_CHATGPT_WEB_AGENT_RESPONSES_PORT = oldGenericPort;
    rmSync(root, { recursive: true, force: true });
  }
}

async function stopsAccepting(url: string): Promise<boolean> {
  for (let attempt = 0; attempt < 20; attempt++) {
    try { await fetch(url, { signal: AbortSignal.timeout(100) }); }
    catch { return true; }
    await Bun.sleep(10);
  }
  return false;
}

test("native startup has no generic listener without an explicitly chosen generic port", async () => {
  const nativePort = unusedLoopbackPort();
  const provider = syntheticProvider();
  let genericBinds = 0;
  const serve: GenericServe = options => {
    genericBinds++;
    return Bun.serve(options);
  };
  const dependencies = {
    fetchUpstream: fakeNativeCatalog,
    agentResponses: { provider, serve },
  };
  const native = startServer({ ...defaultConfig("browser-only"), port: nativePort }, dependencies);
  try {
    expect((await fetch(`http://127.0.0.1:${nativePort}/healthz`)).status).toBe(200);
    expect(genericBinds).toBe(0);
  } finally {
    provider.close();
    await native.stop(true);
  }
});

test("generic listener port comes only from saved settings and ignores environment variables", async () => {
  await withIsolatedRuntimeConfig(() => {
    expect((loadConfig() as ReturnType<typeof loadConfig> & { agentResponsesPort?: number }).agentResponsesPort).toBeUndefined();
    for (const invalid of ["", "0", "65536", "17841", "-1", "1.5", "123x", " 43210 "]) {
      process.env.CODEX_CHATGPT_WEB_AGENT_RESPONSES_PORT = invalid;
      expect(loadConfig().agentResponsesPort).toBeUndefined();
    }
    const config = loadConfig();
    config.agentResponsesPort = 22_411;
    saveConfig(config);
    process.env.CODEX_CHATGPT_WEB_AGENT_RESPONSES_PORT = "12345";
    expect(loadConfig().agentResponsesPort).toBe(22_411);
    for (const invalid of [0, 65_536, 17_841, 1.5]) {
      saveConfig({ ...config, agentResponsesPort: invalid });
      expect(() => loadConfig()).toThrow();
    }
  });
});

test("ordinary saved-config startup honors settings port and persisted generic-only bearer", async () => {
  await withIsolatedRuntimeConfig(async root => {
    const nativePort = unusedLoopbackPort();
    const genericPort = unusedLoopbackPort([nativePort]);
    const config = loadConfig();
    config.port = nativePort;
    config.agentResponsesPort = genericPort;
    saveConfig(config);
    process.env.CODEX_CHATGPT_WEB_AGENT_RESPONSES_PORT = "17841";
    provisionAgentResponsesKey("create", root);
    const secret = JSON.parse(readFileSync(agentResponsesKeyPath(root), "utf8")) as { apiKey: string };
    expect((config as typeof config & { agentResponsesPort?: number }).agentResponsesPort).toBe(genericPort);

    const native = startServer(loadConfig());
    const nativeUrl = `http://127.0.0.1:${nativePort}`;
    const genericUrl = `http://127.0.0.1:${genericPort}`;
    try {
      expect((await fetch(`${nativeUrl}/healthz`)).status).toBe(200);
      expect((await fetch(`${genericUrl}/v1/models`)).status).toBe(401);
      const authorized = { authorization: `Bearer ${secret.apiKey}` };
      expect((await fetch(`${genericUrl}/v1/models`, { headers: authorized })).status).toBe(200);
      expect((await fetch(`${nativeUrl}/admin/drain`, {
        method: "POST", headers: authorized,
      })).status).toBe(401);
      expect((await fetch(`${genericUrl}/v1/models`, { headers: {
        ...authorized, host: `rebound.invalid:${genericPort}`,
      } })).status).toBe(403);

      const nativeAdmin = { authorization: `Bearer ${config.controlToken}` };
      expect((await fetch(`${nativeUrl}/admin/drain`, {
        method: "POST", headers: nativeAdmin,
      })).status).toBe(200);
      expect((await fetch(`${nativeUrl}/admin/shutdown`, {
        method: "POST", headers: nativeAdmin,
      })).status).toBe(200);
      expect(await stopsAccepting(`${genericUrl}/v1/models`)).toBe(true);
    } finally {
      await native.stop(true);
    }
  });
});

test("explicit generic opt-in is wired into the same startup, not native routes, and closes on native shutdown", async () => {
  const nativePort = unusedLoopbackPort();
  const genericPort = unusedLoopbackPort([nativePort]);
  const provider = syntheticProvider();
  let genericServer: { stop(force?: boolean): unknown } | undefined;
  const serve: GenericServe = options => {
    genericServer = Bun.serve(options);
    return genericServer;
  };
  const nativeConfig = { ...defaultConfig("browser-only"), port: nativePort };
  const dependencies = {
    fetchUpstream: fakeNativeCatalog,
    agentResponses: { provider, port: genericPort, serve },
  };
  const native = startServer(nativeConfig, dependencies);
  const nativeUrl = `http://127.0.0.1:${nativePort}`;
  const genericUrl = `http://127.0.0.1:${genericPort}`;
  try {
    // Independent native golden probes run first. No browser, MCP socket, or account is opened.
    const health = await fetch(`${nativeUrl}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ service: "codex-chatgpt-web", mode: "browser-only" });
    expect((await fetch(`${nativeUrl}/v1/models`, {
      headers: { authorization: "Bearer synthetic-native-codex-session" },
    })).status).toBe(200);
    expect((await fetch(`${nativeUrl}/admin/drain`, {
      method: "POST", headers: { authorization: `Bearer ${genericKey}` },
    })).status).toBe(401);

    // Separate listener: native and generic endpoints have independent authorization.
    expect((await fetch(`${genericUrl}/v1/models`)).status).toBe(401);
    const authorized = { authorization: `Bearer ${genericKey}` };
    expect((await fetch(`${genericUrl}/v1/models`, { headers: authorized })).status).toBe(200);
    expect((await fetch(`${genericUrl}/v1/models`, { headers: {
      ...authorized, origin: "https://untrusted.example",
    } })).status).toBe(403);
    const response = await fetch(`${genericUrl}/v1/responses`, { method: "POST",
      headers: { ...authorized, "content-type": "application/json" },
      body: JSON.stringify({ model: "chatgpt-web/gpt-5.6-luna", input: "Synthetic only", stream: false }),
    });
    expect(response.status).toBe(200);
    expect(await response.text()).toContain("Synthetic composed answer");
    expect((await fetch(`${genericUrl}/admin/drain`, {
      method: "POST", headers: authorized,
    })).status).toBe(404);

    const control = { authorization: `Bearer ${nativeConfig.controlToken}` };
    expect((await fetch(`${nativeUrl}/admin/drain`, { method: "POST", headers: control })).status).toBe(200);
    expect((await fetch(`${genericUrl}/v1/models`, { headers: authorized })).status).toBe(503);
    expect((await fetch(`${nativeUrl}/admin/resume`, { method: "POST", headers: control })).status).toBe(200);
    expect((await fetch(`${genericUrl}/v1/models`, { headers: authorized })).status).toBe(200);
    expect((await fetch(`${nativeUrl}/admin/drain`, { method: "POST", headers: control })).status).toBe(200);
    expect((await fetch(`${nativeUrl}/admin/shutdown`, { method: "POST", headers: control })).status).toBe(200);
    expect(await stopsAccepting(`${genericUrl}/v1/models`)).toBe(true);
    expect(await stopsAccepting(`${nativeUrl}/healthz`)).toBe(true);
  } finally {
    // Test owns the injected real listener even if production lifecycle cleanup is missing.
    await genericServer?.stop(true);
    provider.close();
    await native.stop(true);
  }
});

test("generic bind refusal does not prevent the independently configured native listener", async () => {
  const nativePort = unusedLoopbackPort();
  const genericPort = unusedLoopbackPort([nativePort]);
  const occupied = Bun.serve({ hostname: "127.0.0.1", port: genericPort,
    fetch: () => new Response("port already occupied", { status: 209 }) });
  const provider = syntheticProvider();
  let bindAttempts = 0;
  const serve: GenericServe = options => {
    bindAttempts++;
    return Bun.serve(options);
  };
  let native: ReturnType<typeof startServer> | undefined;
  try {
    const dependencies = {
      fetchUpstream: fakeNativeCatalog,
      agentResponses: { provider, port: genericPort, serve },
    };
    native = startServer({ ...defaultConfig("browser-only"), port: nativePort }, dependencies);
    expect(bindAttempts).toBe(1); // Distinguishes actual attempted bind from ignored configuration.
    expect((await fetch(`http://127.0.0.1:${nativePort}/healthz`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${genericPort}/v1/models`)).status).toBe(209);
  } finally {
    await native?.stop(true);
    provider.close();
    await occupied.stop(true);
  }
});

test("native launcher Cancel All retires generic sessions and reports verified idle counters", async () => {
  const nativePort = unusedLoopbackPort();
  const genericPort = unusedLoopbackPort([nativePort]);
  let active = 1;
  let cancellationCalls = 0;
  const manager = {
    activeCount: () => active,
    cancelAll: () => { cancellationCalls++; active = 0; return 1; },
    closeAll: () => { active = 0; },
  };
  const provider = new AgentResponsesProvider({ ...defaultConfig("full"), browserInteractionMode: "automatic" },
    {} as TurnBroker, genericKey, manager as never);
  const config = { ...defaultConfig("browser-only"), port: nativePort };
  const native = startServer(config, { fetchUpstream: fakeNativeCatalog,
    agentResponses: { port: genericPort, provider, serve: options => Bun.serve(options) } });
  const base = `http://127.0.0.1:${nativePort}`;
  const headers = { authorization: `Bearer ${config.controlToken}` };
  try {
    expect(await (await fetch(`${base}/healthz`)).json()).toMatchObject({
      active_generic_turns: 1,
    });
    const result = await fetch(`${base}/admin/cancel-turns`, { method: "POST", headers });
    expect(result.status).toBe(200);
    expect(await result.json()).toMatchObject({
      cancelled_generic_turns: 1, active_generic_turns: 0,
    });
    expect(cancellationCalls).toBe(1);
  } finally { provider.close(); await native.stop(true); }
});
