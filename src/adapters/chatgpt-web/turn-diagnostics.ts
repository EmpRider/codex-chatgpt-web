import { createHash } from "node:crypto";
import { appendFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { appendFileSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import { VERSION } from "../../version";

type TurnDiagnosticEvent = "token_prepared" | "prompt_verified" | "submission_accepted" | "token_registered" | "token_retired" | "broker_claim" | "mcp_started" | "mcp_claim_started" | "mcp_claim_succeeded" | "mcp_claim_failed" | "token_rejection_recovery";
type FailureClass = "invalid_token" | "retired_token" | "broker_unreachable" | "timeout" | "aborted" | "other";
interface TurnDiagnosticFields {
  token?: string;
  brokerEndpoint?: string;
  traceId?: string;
  toolName?: string;
  transport?: "inline" | "multipart" | "mcp";
  promptChars?: number;
  skillFiles?: number;
  freshConversation?: boolean;
  valid?: boolean;
  completionCommitted?: boolean;
  activeMcpRequests?: number;
  activeTokens?: number;
  failureClass?: FailureClass;
}

export function diagnosticFingerprint(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 12);
}

export function classifyTurnDiagnosticError(error: unknown): FailureClass {
  const message = error instanceof Error ? error.message : "";
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (message.includes("which has already finished")) return "retired_token";
  if (message.includes("invalid, expired, or revoked")) return "invalid_token";
  if (["ENOENT", "ECONNREFUSED", "EPIPE", "ECONNRESET"].includes(String(code))) return "broker_unreachable";
  if (/timeout|timed out/i.test(message)) return "timeout";
  if (error instanceof Error && error.name === "AbortError") return "aborted";
  return "other";
}

// Explicit projection: never serialize supplied errors, prompts, endpoints or capability handles.
export function buildTurnDiagnostic(event: TurnDiagnosticEvent, fields: TurnDiagnosticFields) {
  const detail: Record<string, string | number | boolean> = { pid: process.pid, version: VERSION };
  if (fields.token) { detail.tokenHash = diagnosticFingerprint(fields.token); detail.tokenChars = fields.token.length; }
  if (fields.brokerEndpoint) detail.endpointHash = diagnosticFingerprint(fields.brokerEndpoint);
  for (const key of ["traceId", "toolName"] as const) {
    const value = fields[key];
    if (value && /^[A-Za-z0-9_-]{1,128}$/.test(value)) detail[key] = value;
  }
  if (fields.transport && ["inline", "multipart", "mcp"].includes(fields.transport)) detail.transport = fields.transport;
  if (fields.failureClass && ["invalid_token", "retired_token", "broker_unreachable", "timeout", "aborted", "other"].includes(fields.failureClass)) detail.failureClass = fields.failureClass;
  for (const key of ["promptChars", "skillFiles", "activeMcpRequests", "activeTokens"] as const) {
    const value = fields[key];
    if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) detail[key] = value;
  }
  for (const key of ["freshConversation", "valid", "completionCommitted"] as const) {
    if (typeof fields[key] === "boolean") detail[key] = fields[key];
  }
  return { at: new Date().toISOString(), level: "info", event: `turn.${event}`, detail };
}

let lastPrune = 0;
const pending: { directory: string; line: string }[] = [];
let pendingBytes = 0;
let timer: ReturnType<typeof setTimeout> | undefined;
let writing: Promise<void> | undefined;

// Preserve the previous immediate writer on Windows while investigating Bun
// named-pipe teardown stalls. Other platforms use the bounded asynchronous queue.
function writeWindowsDiagnostics(directory: string, lines: string[]): void {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  const file = join(directory, `process-${process.pid}.jsonl`);
  if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) >= 2 * 1024 * 1024) {
    rmSync(`${file}.1`, { force: true });
    renameSync(file, `${file}.1`);
  }
  appendFileSync(file, lines.join(""), { mode: 0o600 });
  if (Date.now() - lastPrune > 60_000) {
    lastPrune = Date.now();
    const files = readdirSync(directory).filter(name => /^process-\d+\.jsonl(?:\.1)?$/.test(name))
      .map(name => ({ name, modified: statSync(join(directory, name)).mtimeMs }))
      .sort((a, b) => b.modified - a.modified);
    for (const entry of files.slice(40)) rmSync(join(directory, entry.name), { force: true });
  }
}

function scheduleDiagnostics(): void {
  if (timer || writing || !pending.length) return;
  timer = setTimeout(() => { void drainDiagnostics(); }, 25);
  timer.unref?.();
}

function drainDiagnostics(): Promise<void> {
  if (timer) { clearTimeout(timer); timer = undefined; }
  if (writing || !pending.length) return writing ?? Promise.resolve();
  const batch = pending.splice(0);
  pendingBytes = 0;
  writing = (async () => {
    const groups = new Map<string, string[]>();
    for (const { directory, line } of batch) {
      const lines = groups.get(directory) ?? [];
      lines.push(line);
      groups.set(directory, lines);
    }
    for (const [directory, lines] of groups) {
      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const file = join(directory, `process-${process.pid}.jsonl`);
        if (((await stat(file).catch(() => null))?.size ?? 0) >= 2 * 1024 * 1024) {
          await rm(`${file}.1`, { force: true });
          await rename(file, `${file}.1`);
        }
        await appendFile(file, lines.join(""), { mode: 0o600 });
        if (Date.now() - lastPrune > 60_000) {
          lastPrune = Date.now();
          const names = (await readdir(directory)).filter(name => /^process-\d+\.jsonl(?:\.1)?$/.test(name));
          const files = await Promise.all(names.map(async name => ({ name, modified: (await stat(join(directory, name)).catch(() => null))?.mtimeMs ?? 0 })));
          files.sort((a, b) => b.modified - a.modified);
          for (const entry of files.slice(40)) await rm(join(directory, entry.name), { force: true });
        }
      } catch { /* Diagnostics must not affect execution or MCP stdout framing. */ }
    }
  })().finally(() => { writing = undefined; scheduleDiagnostics(); });
  return writing;
}

export async function flushTurnDiagnostics(): Promise<void> {
  do { await drainDiagnostics(); } while (writing || pending.length);
}

process.on("beforeExit", () => { if (pending.length || writing) void flushTurnDiagnostics(); });

export function logTurnDiagnostic(event: TurnDiagnosticEvent, fields: TurnDiagnosticFields): void {
  try {
    const directory = join(getConfigDir(), "diagnostics", "turn-lifecycle");
    const line = `${JSON.stringify(buildTurnDiagnostic(event, fields))}\n`;
    if (process.platform === "win32") {
      writeWindowsDiagnostics(directory, [line]);
      return;
    }
    const bytes = Buffer.byteLength(line);
    // Bound diagnostics while a disk is stalled; the live task always takes precedence.
    while (pending.length && pendingBytes + bytes > 512 * 1024) pendingBytes -= Buffer.byteLength(pending.shift()!.line);
    if (bytes > 512 * 1024) return;
    pending.push({ directory, line });
    pendingBytes += bytes;
    scheduleDiagnostics();
  } catch {
    // Diagnostics must never affect token authorization, task execution or MCP stdout framing.
  }
}
