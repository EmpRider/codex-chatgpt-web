import { createHash } from "node:crypto";
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
export function logTurnDiagnostic(event: TurnDiagnosticEvent, fields: TurnDiagnosticFields): void {
  try {
    const directory = join(getConfigDir(), "diagnostics", "turn-lifecycle");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const file = join(directory, `process-${process.pid}.jsonl`);
    // Each process owns its file; avoid shared-file rotation races between daemon and MCP.
    if ((statSync(file, { throwIfNoEntry: false })?.size ?? 0) >= 2 * 1024 * 1024) {
      rmSync(`${file}.1`, { force: true });
      renameSync(file, `${file}.1`);
    }
    appendFileSync(file, `${JSON.stringify(buildTurnDiagnostic(event, fields))}\n`, { mode: 0o600 });
    if (Date.now() - lastPrune > 60_000) {
      lastPrune = Date.now();
      const files = readdirSync(directory).filter(name => /^process-\d+\.jsonl(?:\.1)?$/.test(name))
        .map(name => ({ name, modified: statSync(join(directory, name)).mtimeMs }))
        .sort((a, b) => b.modified - a.modified);
      for (const entry of files.slice(40)) {
        rmSync(join(directory, entry.name), { force: true });
      }
    }
  } catch {
    // Diagnostics must never affect token authorization, task execution or MCP stdout framing.
  }
}
