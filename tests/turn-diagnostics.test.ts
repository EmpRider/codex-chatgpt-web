import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { logTurnDiagnostic, flushTurnDiagnostics, buildTurnDiagnostic, classifyTurnDiagnosticError } from "../src/adapters/chatgpt-web/turn-diagnostics";

test("correlation fingerprints match across processes without leaking credentials or paths", () => {
  const token = `turn_${"x".repeat(32)}`;
  const endpoint = "C:\\Users\\private-user\\broker.sock";
  const record = buildTurnDiagnostic("mcp_claim_started", { token, brokerEndpoint: endpoint, traceId: "trace-123", toolName: "codex_exec" });
  const text = JSON.stringify(record);
  expect(text).not.toContain(token);
  expect(text).not.toContain(endpoint);
  expect(record.detail.tokenHash).toHaveLength(12);
  expect(record.detail.endpointHash).toHaveLength(12);
  expect(buildTurnDiagnostic("token_prepared", { token, brokerEndpoint: endpoint }).detail.tokenHash).toBe(record.detail.tokenHash);
  expect(buildTurnDiagnostic("token_prepared", { token: token + "y", brokerEndpoint: endpoint }).detail.tokenHash).not.toBe(record.detail.tokenHash);
  expect(record.detail.pid).toBe(process.pid);
});

test("diagnostics discard unexpected fields and malformed identifiers", () => {
  const record = buildTurnDiagnostic("token_prepared", { token: "secret", traceId: "unsafe\nsecret", prompt: "private prompt", response: "private response" } as any);
  expect(record.detail.traceId).toBeUndefined();
  expect(JSON.stringify(record)).not.toContain("private");
  expect(JSON.stringify(record)).not.toContain("secret");
});

test("failure classes distinguish rejected handles from transport failures without error text", () => {
  expect(classifyTurnDiagnosticError(new Error("turn token is invalid, expired, or revoked"))).toBe("invalid_token");
  expect(classifyTurnDiagnosticError(new Error("This turn_token was issued for an earlier turn, which has already finished."))).toBe("retired_token");
  expect(classifyTurnDiagnosticError(Object.assign(new Error("private path"), { code: "ENOENT" }))).toBe("broker_unreachable");
  expect(classifyTurnDiagnosticError(new Error("private secret"))).toBe("other");
});


test("independent process logs flush asynchronously, rotate, and tolerate failed writes", async () => {
  const home = mkdtempSync(join(tmpdir(), "cgw-turn-diagnostics-"));
  const previous = process.env.CODEX_CHATGPT_WEB_HOME;
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  try {
    logTurnDiagnostic("mcp_started", { brokerEndpoint: "private-endpoint" });
    const pending = flushTurnDiagnostics();
    expect(pending).toBeInstanceOf(Promise);
    await pending;
    const directory = join(home, "diagnostics", "turn-lifecycle");
    const file = join(directory, `process-${process.pid}.jsonl`);
    expect(JSON.parse(readFileSync(file, "utf8").trim()).event).toBe("turn.mcp_started");
    writeFileSync(file, "x".repeat(2 * 1024 * 1024));
    logTurnDiagnostic("mcp_claim_started", { token: "private-token" });
    await flushTurnDiagnostics();
    expect(readFileSync(`${file}.1`, "utf8").length).toBe(2 * 1024 * 1024);
    expect(JSON.parse(readFileSync(file, "utf8").trim()).event).toBe("turn.mcp_claim_started");
    const blocked = join(home, "blocked");
    writeFileSync(blocked, "file");
    process.env.CODEX_CHATGPT_WEB_HOME = blocked;
    expect(() => logTurnDiagnostic("mcp_started", {})).not.toThrow();
    await flushTurnDiagnostics();
  } finally {
    if (previous === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
    else process.env.CODEX_CHATGPT_WEB_HOME = previous;
    rmSync(home, { recursive: true, force: true });
  }
});

test("browser helper graceful shutdown flushes its final lifecycle records", async () => {
  const home = mkdtempSync(join(tmpdir(), "cgw-helper-diagnostics-"));
  const worker = fileURLToPath(new URL("../src/adapters/chatgpt-web/browser-worker.ts", import.meta.url));
  const diagnostics = pathToFileURL(join(import.meta.dir, "../src/adapters/chatgpt-web/turn-diagnostics.ts")).href;
  const helper = pathToFileURL(join(import.meta.dir, "../src/adapters/chatgpt-web/browser-helper-main.ts")).href;
  const script = `
    import { mock } from "bun:test";
    const { logTurnDiagnostic } = await import(${JSON.stringify(diagnostics)});
    mock.module(${JSON.stringify(worker)}, () => ({
      ChatGptBrowserWorker: class {},
      closeChatGptBrowserWorkers: async () => logTurnDiagnostic("submission_accepted", { traceId: "shutdown-final" }),
    }));
    await import(${JSON.stringify(helper)});
  `;
  try {
    const child = Bun.spawn([process.execPath, "-e", script], {
      env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home },
      stdin: "pipe", stdout: "pipe", stderr: "pipe",
    });
    child.stdin.write('{"type":"shutdown"}\n');
    child.stdin.end();
    const timer = setTimeout(() => child.kill(), 5_000);
    try {
      const stderr = await new Response(child.stderr).text();
      expect(stderr).toBe("");
      expect(await child.exited).toBe(0);
    } finally { clearTimeout(timer); }
    const records = readFileSync(join(home, "diagnostics", "turn-lifecycle", `process-${child.pid}.jsonl`), "utf8");
    expect(records).toContain('"traceId":"shutdown-final"');
  } finally { rmSync(home, { recursive: true, force: true }); }
});
