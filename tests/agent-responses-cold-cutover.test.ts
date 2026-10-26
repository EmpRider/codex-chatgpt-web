import { expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeTurnBrokers } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint, defaultConfig } from "../src/config";
import { startServer } from "../src/server";

const oldBearer = `synthetic-old-operator-${"k".repeat(48)}`;

test("cold cutover rejects both former provider routes even with the old bearer and environment key", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent-responses-cutover-"));
  const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
  const previousLegacyKey = process.env.CODEX_CHATGPT_WEB_9ROUTER_API_KEY;
  const oldJournal = join(root, "integrations", "nine-router-attempts", "preexisting-unknown.json");
  const sentinel = '{"state":"outcome_unknown","synthetic":true}\n';
  mkdirSync(join(root, "integrations", "nine-router-attempts"), { recursive: true });
  writeFileSync(oldJournal, sentinel);
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  process.env.CODEX_CHATGPT_WEB_9ROUTER_API_KEY = oldBearer;

  const server = startServer({
    ...defaultConfig("full"),
    port: 0,
    brokerSocketPath: defaultBrokerEndpoint(root),
    browserInteractionMode: "automatic",
  });
  try {
    const nativeBase = `http://127.0.0.1:${server.port}`;
    const authorized = { authorization: `Bearer ${oldBearer}` };
    // Both probes are harmless before the cutover: models reads only; the invalid
    // content type is rejected before the current legacy browser Send path.
    const models = await fetch(`${nativeBase}/integrations/9router/v1/models`, {
      headers: authorized,
    });
    const responses = await fetch(`${nativeBase}/integrations/9router/v1/responses`, {
      method: "POST",
      headers: { ...authorized, "content-type": "text/plain" },
      body: "synthetic-not-a-browser-request",
    });
    expect([models.status, responses.status]).toEqual([404, 404]);
    const health = await fetch(`${nativeBase}/healthz`);
    expect(health.status).toBe(200);
    expect(await health.json()).toMatchObject({ active_browser_turns: 0, active_http_turns: 0 });
    expect(readFileSync(oldJournal, "utf8")).toBe(sentinel);
  } finally {
    await server.stop(true);
    await closeTurnBrokers();
    if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
    if (previousLegacyKey === undefined) delete process.env.CODEX_CHATGPT_WEB_9ROUTER_API_KEY;
    else process.env.CODEX_CHATGPT_WEB_9ROUTER_API_KEY = previousLegacyKey;
    rmSync(root, { recursive: true, force: true });
  }
});

test("cold cutover rejects the old key CLI without touching saved legacy data", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-responses-cutover-cli-"));
  const keyPath = join(root, "integrations", "nine-router-key.json");
  const saved = '{"version":1,"apiKey":"synthetic-legacy-test-data"}\n';
  mkdirSync(join(root, "integrations"), { recursive: true });
  writeFileSync(keyPath, saved);
  try {
    // 'path' is side-effect-free even before C1; never call create/rotate/disable.
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "..", "src", "cli.ts"),
        "--home", root, "9router-key", "path"],
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CODEX_CHATGPT_WEB_HOME: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(1);
    expect(new TextDecoder().decode(result.stderr)).toContain("Unknown command: 9router-key");
    expect(readFileSync(keyPath, "utf8")).toBe(saved);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cold cutover offers the generic key path without changing the existing key file", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-responses-cutover-generic-cli-"));
  const keyPath = join(root, "integrations", "agent-responses-key.json");
  const saved = '{"version":1,"apiKey":"synthetic-generic-test-data"}\n';
  mkdirSync(join(root, "integrations"), { recursive: true });
  writeFileSync(keyPath, saved);
  try {
    const result = Bun.spawnSync({
      cmd: [process.execPath, join(import.meta.dir, "..", "src", "cli.ts"),
        "--home", root, "agent-responses-key", "path"],
      cwd: join(import.meta.dir, ".."),
      env: { ...process.env, CODEX_CHATGPT_WEB_HOME: root },
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(result.exitCode).toBe(0);
    expect(new TextDecoder().decode(result.stdout).trim()).toBe(keyPath);
    expect(readFileSync(keyPath, "utf8")).toBe(saved);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
