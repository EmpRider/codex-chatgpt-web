import { createHmac, randomBytes } from "node:crypto";

// Keep diagnostic vocabulary closed: caller-owned strings never become log data.
const LEVELS = ["DEBUG", "INFO", "WARN", "ERROR"] as const;
const CATEGORIES = ["api", "journal", "browser", "broker", "mcp", "recovery"] as const;
const EVENTS = [
  "request_started", "request_completed", "request_failed", "auth_rejected", "request_rejected",
  "journal_claimed", "journal_failed", "browser_started", "prompt_prepared", "send_activated", "send_accepted",
  "send_unknown", "browser_rebound", "browser_finished", "tool_batch_delivered",
  "tool_results_received", "tool_results_returned", "tool_results_rejected", "owner_retired", "session_retired",
  "recovery_observed",
] as const;
const PHASES = [
  "admission", "auth", "validation", "journal", "send", "accepted", "tools",
  "completion", "retirement", "recovery", "shutdown",
] as const;
const CODES = [
  "ok", "unauthorized", "invalid_request", "model_rejected", "conflict", "capacity",
  "unavailable", "timeout", "storage_failed", "unknown_outcome", "owner_mismatch",
  "partial_results", "cancelled", "internal",
] as const;
const HTTP_STATUSES = [200, 400, 401, 403, 404, 409, 413, 415, 422, 429, 500, 503, 504, 507] as const;

type Member<T extends readonly unknown[]> = T[number];
export interface ActivityEvent {
  readonly version: 1;
  readonly at: string;
  readonly level: Member<typeof LEVELS>;
  readonly category: Member<typeof CATEGORIES>;
  readonly event: Member<typeof EVENTS>;
  readonly phase: Member<typeof PHASES>;
  readonly code: Member<typeof CODES>;
  readonly http_status?: Member<typeof HTTP_STATUSES>;
  readonly duration_ms?: number;
  readonly count?: number;
  readonly buffer_bytes?: number;
  readonly request_hash?: string;
  readonly session_hash?: string;
  readonly turn_hash?: string;
}

export type ActivityDraft = Pick<ActivityEvent, "level" | "category" | "event" | "phase" | "code">
  & Pick<ActivityEvent, "http_status" | "duration_ms" | "count" | "buffer_bytes">;

export interface ActivityCorrelationIds {
  readonly requestId?: string;
  readonly sessionId?: string;
  readonly turnId?: string;
}

const DRAFT_KEYS = new Set([
  "level", "category", "event", "phase", "code", "http_status", "duration_ms", "count", "buffer_bytes",
]);
const EVENT_KEYS = new Set([
  ...DRAFT_KEYS, "version", "at", "request_hash", "session_hash", "turn_hash",
]);
const CORRELATION_KEYS = new Set(["requestId", "sessionId", "turnId"]);
const HASH_PATTERN = /^[a-f0-9]{32}$/;
const ISO_PATTERN = /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/;
// In-process factory issuance only; this is not principal or IPC source authentication.
const factoryIssuedEvents = new WeakSet<object>();

function ownDataRecord(value: unknown, allow: ReadonlySet<string>): Record<string, unknown> | null {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return null;
  const snapshot: Record<string, unknown> = Object.create(null);
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== "string" || !allow.has(key)) return null;
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !descriptor.enumerable || !("value" in descriptor)) return null;
    snapshot[key] = descriptor.value;
  }
  return snapshot;
}

function finiteEnum(value: unknown, members: readonly (string | number)[]): boolean {
  return members.includes(value as never);
}

function boundedInteger(value: unknown, max: number): boolean {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 && value <= max;
}

function safeFields(record: Record<string, unknown>): boolean {
  if (!finiteEnum(record.level, LEVELS) || !finiteEnum(record.category, CATEGORIES)
    || !finiteEnum(record.event, EVENTS) || !finiteEnum(record.phase, PHASES)
    || !finiteEnum(record.code, CODES)) return false;
  if ("http_status" in record && !finiteEnum(record.http_status, HTTP_STATUSES)) return false;
  if ("duration_ms" in record && !boundedInteger(record.duration_ms, 86_400_000)) return false;
  if ("count" in record && !boundedInteger(record.count, 1_000_000)) return false;
  if ("buffer_bytes" in record && !boundedInteger(record.buffer_bytes, 16_777_216)) return false;
  return true;
}

/** Rejects unknown, accessor, nested, arbitrary-text, and unbounded data; never throws. */
export function validateActivityEvent(input: unknown): ActivityEvent | null {
  try {
    const record = ownDataRecord(input, EVENT_KEYS);
    if (!record || record.version !== 1 || !safeFields(record)) return null;
    if (typeof record.at !== "string" || !ISO_PATTERN.test(record.at)
      || Number.isNaN(Date.parse(record.at)) || new Date(record.at).toISOString() !== record.at) return null;
    for (const field of ["request_hash", "session_hash", "turn_hash"]) {
      if (field in record && (typeof record[field] !== "string" || !HASH_PATTERN.test(record[field]))) return null;
    }
    return Object.freeze({ ...record }) as unknown as ActivityEvent;
  } catch {
    return null;
  }
}

/** Create once per supervised runtime, then share the instance across event sources. */
export function createActivityContract(): {
  create: (draft: unknown, ids?: unknown) => ActivityEvent | null;
} {
  const key = randomBytes(32);
  const hash = (domain: "request" | "session" | "turn", raw: string): string =>
    createHmac("sha256", key).update(`activity.v1\0${domain}\0`).update(raw).digest("hex").slice(0, 32);

  return Object.freeze({
    create(draft: unknown, ids?: unknown): ActivityEvent | null {
      try {
        const fields = ownDataRecord(draft, DRAFT_KEYS);
        if (!fields || !safeFields(fields)) return null;
        const correlations = ids === undefined ? {} : ownDataRecord(ids, CORRELATION_KEYS);
        if (!correlations) return null;
        for (const value of Object.values(correlations)) {
          if (typeof value !== "string" || value.length === 0 || value.length > 256) return null;
        }
        const event = {
          version: 1,
          at: new Date().toISOString(),
          level: fields.level,
          category: fields.category,
          event: fields.event,
          phase: fields.phase,
          code: fields.code,
          ...(fields.http_status !== undefined ? { http_status: fields.http_status } : {}),
          ...(fields.duration_ms !== undefined ? { duration_ms: fields.duration_ms } : {}),
          ...(fields.count !== undefined ? { count: fields.count } : {}),
          ...(fields.buffer_bytes !== undefined ? { buffer_bytes: fields.buffer_bytes } : {}),
          ...(correlations.requestId ? { request_hash: hash("request", correlations.requestId as string) } : {}),
          ...(correlations.sessionId ? { session_hash: hash("session", correlations.sessionId as string) } : {}),
          ...(correlations.turnId ? { turn_hash: hash("turn", correlations.turnId as string) } : {}),
        };
        const validated = validateActivityEvent(event);
        if (validated) factoryIssuedEvents.add(validated);
        return validated;
      } catch {
        return null;
      }
    },
  });
}

/** Observer errors cannot propagate to requests, browser sends, tool ACKs, or journal writes. */
export function observeActivity(
  candidate: unknown,
  sink: (event: ActivityEvent) => void | Promise<unknown>,
): void {
  try {
    if (candidate === null || typeof candidate !== "object" || !factoryIssuedEvents.has(candidate)) return;
    const event = validateActivityEvent(candidate);
    if (!event) return;
    void Promise.resolve(sink(event)).catch(() => {});
  } catch {
    // Activity is best-effort; never escalate a telemetry failure to execution.
  }
}

// The supervised Bun daemon already forwards stdout to the Electron launcher.
// Keep the event payload closed and numeric so the original Activity logger/exporter
// can consume it without receiving request bodies, browser text, or credentials.
export const AGENT_RESPONSES_ACTIVITY_PREFIX = "[agent-responses.activity] ";
const activityContract = createActivityContract();

export function reportAgentResponsesActivity(draft: ActivityDraft, ids?: ActivityCorrelationIds): void {
  observeActivity(activityContract.create(draft, ids), event => {
    try { process.stdout.write(`${AGENT_RESPONSES_ACTIVITY_PREFIX}${JSON.stringify(event)}\n`); }
    catch { /* A missing diagnostic stream must never affect an API response. */ }
  });
}
