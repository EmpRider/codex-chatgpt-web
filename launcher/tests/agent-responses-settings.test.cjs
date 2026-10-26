const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const vm = require("node:vm");
const { RuntimeHost } = require("../electron/runtime.cjs");
const { createLogger, exportSanitizedLogs, parseGatewayActivityLine } = require("../electron/logging.cjs");

test("Settings saves the independent API port in the runtime config, not the launcher state or environment", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "generic-settings-"));
  const configPath = path.join(directory, "config.json");
  const source = { version: 1, browserHost: "launcher", port: 17_841, controlToken: "preserve-this" };
  fs.writeFileSync(configPath, JSON.stringify(source));
  const records = [];
  const host = {
    supervisor: { configPath, readSetupConfig: () => JSON.parse(fs.readFileSync(configPath, "utf8")) },
    runtimeConfigSnapshot: () => ({ configured: true, owner: "launcher", config: JSON.parse(fs.readFileSync(configPath, "utf8")) }),
    logger: { info: (event, detail) => records.push({ event, detail }) },
  };
  try {
    assert.deepEqual(RuntimeHost.prototype.setAgentResponsesPort.call(host, 22_411), { port: 22_411 });
    assert.equal(host.supervisor.readSetupConfig().agentResponsesPort, 22_411);
    assert.equal(host.supervisor.readSetupConfig().controlToken, "preserve-this");
    for (const invalid of [0, 17_841, 65_536, "22411", 1.5]) {
      assert.throws(() => RuntimeHost.prototype.setAgentResponsesPort.call(host, invalid), /Generic OpenAI API port/);
    }
    assert.equal(host.supervisor.readSetupConfig().agentResponsesPort, 22_411);
    assert.deepEqual(RuntimeHost.prototype.setAgentResponsesPort.call(host, null), { port: null });
    assert.equal(Object.hasOwn(host.supervisor.readSetupConfig(), "agentResponsesPort"), false);
    assert.equal(records.length, 2);
    assert.equal(records[0].event, "agent_responses.settings_port_saved");
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});

test("Settings IPC updates the displayed port from the canonical runtime configuration", () => {
  const main = fs.readFileSync(path.join(__dirname, "..", "electron", "main.cjs"), "utf8");
  const sync = main.slice(main.indexOf("function syncBrowserPreferences("), main.indexOf("function registerIpc("));
  const ipc = main.slice(main.indexOf('handle("launcher:agent-responses-port",'), main.indexOf('handle("launcher:logs",'));
  const config = { agentResponsesPort: undefined, composerPredictionsEnabled: true };
  const state = { composerPredictionsEnabled: true,
    experimentalFreshConversationPerTurn: false, experimentalBiggerContext: false,
    autoApproveToolCalls: false, biggerContextAvailable: false };
  let handler;
  let operation = null;
  const observed = [];
  vm.runInNewContext(`${sync}\n${ipc}`, {
    handle: (_channel, callback) => { handler = callback; },
    runtimeHost: {
      currentOperation: () => operation,
      setAgentResponsesPort: port => { config.agentResponsesPort = port ?? undefined; },
      runtimeConfigSnapshot: () => ({ config }),
    },
    browserHost: { turnTabs: new Map() },
    stateStore: { read: () => ({ ...state }), update: patch => Object.assign(state, patch) },
    releaseRetainedConversation() {},
    send: (event, value) => observed.push({ event, value }),
  });
  operation = "setup";
  assert.throws(() => handler(null, 22_411), /Finish the current launcher operation/);
  assert.equal(config.agentResponsesPort, undefined);
  operation = null;
  assert.equal(handler(null, 22_411).agentResponsesPort, 22_411);
  assert.equal(observed.at(-1)?.event, "launcher:state-changed");
  assert.equal(handler(null, null).agentResponsesPort, null);
});

test("gateway activity uses the original logger and sanitized export without leaking private fields", () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "generic-activity-"));
  const filePath = path.join(directory, "activity.jsonl");
  const exported = path.join(directory, "export.jsonl");
  const logger = createLogger({ filePath });
  const payload = {
    version: 1, at: new Date().toISOString(), level: "INFO", category: "api", event: "request_completed",
    phase: "completion", code: "ok", http_status: 200, duration_ms: 43,
    request_hash: "a".repeat(32),
  };
  try {
    const parsed = parseGatewayActivityLine(`[agent-responses.activity] ${JSON.stringify(payload)}`);
    assert.deepEqual(parsed, { level: "info", event: "agent_responses.api.request_completed",
      detail: { phase: "completion", code: "ok", http_status: 200, duration_ms: 43, request_hash: "a".repeat(32) } });
    logger[parsed.level](parsed.event, parsed.detail);
    assert.equal(logger.recent().at(-1).event, "agent_responses.api.request_completed");
    assert.equal(exportSanitizedLogs({ filePath, destinationPath: exported }), 1);
    assert.match(fs.readFileSync(exported, "utf8"), /agent_responses\.api\.request_completed/);
    assert.equal(parseGatewayActivityLine(`[agent-responses.activity] ${JSON.stringify({ ...payload, apiKey: "secret" })}`), null);
    assert.equal(parseGatewayActivityLine(`[agent-responses.activity] ${JSON.stringify({ ...payload, request_hash: "sk-EXPOSEDsecretKey1234" })}`), null);
  } finally { fs.rmSync(directory, { recursive: true, force: true }); }
});
