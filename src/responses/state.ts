import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { chmod, mkdir, rename, rm, writeFile } from "node:fs/promises";
import { setImmediate as yieldToRequests, setTimeout as delay } from "node:timers/promises";
import { getConfigDir } from "../config";

import { bindPreparedResponseHistory, forgetResponseHistory, scheduleResponseHistoryPreparation } from "./prepared-history";
export { preparedResponseHistoryStats } from "./prepared-history";

const MAX_STORED_RESPONSES = 1_000;
const RESPONSE_TTL_MS = 60 * 60 * 1_000;
const SNAPSHOT_DEBOUNCE_MS = 2_000;
/** In-memory high-water byte cap across all entries. Forced store:false continuation chains
 * store the full expanded input each turn — ~quadratic bytes per chain —
 * so a count cap alone cannot bound memory. Oldest-first eviction applies past this mark. */
const MAX_STORED_RESPONSE_BYTES = 64 * 1024 * 1024;
/** Entries whose serialized size exceeds this are kept in memory but skipped on disk: inputs can
 * carry base64 `input_image` data URLs, and one screenshot-heavy thread must not balloon the file. */
const SNAPSHOT_ENTRY_MAX_BYTES = 2 * 1024 * 1024;
const SNAPSHOT_TOTAL_MAX_BYTES = 24 * 1024 * 1024;

interface StoredResponseState {
  createdAt: number;
  items: unknown[];
  /** Approximate in-memory size, computed locally at insert time (never trusted from disk). */
  sizeBytes?: number;
  serializedBytes?: number;
}

const states = new Map<string, StoredResponseState>();
let storedResponseBytes = 0;

/** The ONLY size computation: approximate entry weight from its items payload. */
function measuredEntry(entry: Omit<StoredResponseState, "sizeBytes">): StoredResponseState {
  let sizeBytes = 0;
  let serializedBytes = 0;
  try {
    const serialized = JSON.stringify(entry.items);
    serializedBytes = Buffer.byteLength(serialized, "utf8");
    sizeBytes = Math.max(serializedBytes, serialized.length * 2);
  } catch {
    /* unserializable items: weightless rather than fatal */
  }
  return { ...entry, sizeBytes, serializedBytes };
}

/** The ONLY insertion point: keeps the byte counter consistent on replacement. */
function setEntry(id: string, entry: Omit<StoredResponseState, "sizeBytes">): void {
  deleteEntry(id);
  const measured = measuredEntry(entry);
  storedResponseBytes += measured.sizeBytes ?? 0;
  states.set(id, measured);
}

/** The ONLY deletion point: TTL, count, byte, and explicit deletes all route here. */
function deleteEntry(id: string): void {
  const existing = states.get(id);
  if (!existing) return;
  forgetResponseHistory(existing.items);
  storedResponseBytes -= existing.sizeBytes ?? 0;
  if (storedResponseBytes < 0) storedResponseBytes = 0;
  states.delete(id);
}
// Expansion provenance must stay proxy-private: a WeakMap distinguishes replayed history from the
// newly appended input suffix without adding an unknown field that native passthrough could send
// upstream. Consumers use the prefix length to bind trusted history and rolling checkpoints to the
// exact replayed portion of this request.
const replayedInputPrefixLengths = new WeakMap<object, number>();
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;
let pendingPersistPath: string | null = null;
let persistChain: Promise<void> = Promise.resolve();
let persistRunning = false;
const pendingSnapshots = new Map<string, [string, StoredResponseState][]>();

function now(): number {
  return Date.now();
}

function snapshotPath(): string {
  return join(getConfigDir(), "responses-state.json");
}

/**
 * Best-effort disk snapshot so previous_response_id chains survive a proxy restart (the
 * dominant expansion-miss cause: an in-memory-only store dies with the process, and the next
 * chained turn then reaches the upstream as a naked delta). Load is lazy on first store access;
 * persistence is debounced + unref'd so the hot path never blocks and the process can exit.
 * Every disk failure is swallowed — the snapshot is a cache, not a source of truth.
 */
function ensureLoaded(): void {
  if (loaded) return;
  loaded = true;
  try {
    const path = snapshotPath();
    if (!existsSync(path)) return;
    const raw = JSON.parse(readFileSync(path, "utf-8")) as { version?: unknown; states?: unknown };
    if (raw.version !== 1 || !Array.isArray(raw.states)) return;
    for (const entry of raw.states) {
      if (!Array.isArray(entry) || entry.length !== 2) continue;
      const [id, state] = entry as [unknown, unknown];
      if (typeof id !== "string" || !state || typeof state !== "object") continue;
      const rec = state as StoredResponseState;
      if (typeof rec.createdAt !== "number" || !Array.isArray(rec.items)) continue;
      // Recompute sizes locally while loading; persisted sizeBytes is never trusted.
      setEntry(id, {
        createdAt: rec.createdAt,
        items: rec.items,
      });
    }
    pruneResponses();
  } catch {
    /* missing/corrupt snapshot: start empty */
  }
}

async function persistSnapshot(path: string, snapshot: [string, StoredResponseState][]): Promise<void> {
  let temp: string | undefined;
  try {
    const entries: string[] = [];
    let total = 0;
    let sinceYield = 0;
    // Newest-first so the most recent chains survive both caps.
    for (const entry of snapshot.reverse()) {
      // sizeBytes is in-memory accounting only; keep it out of the disk snapshot.
      const [id, state] = entry;
      if ((state.serializedBytes ?? 0) > SNAPSHOT_ENTRY_MAX_BYTES) continue;
      const { sizeBytes: _sizeBytes, serializedBytes: _serializedBytes, ...persistable } = state;
      const persistEntry: [string, StoredResponseState] = [id, persistable];
      const serialized = JSON.stringify(persistEntry);
      const size = Buffer.byteLength(serialized, "utf8");
      if (size > SNAPSHOT_ENTRY_MAX_BYTES) continue;
      if (total + size > SNAPSHOT_TOTAL_MAX_BYTES) break;
      total += size;
      entries.push(serialized);
      sinceYield += size;
      if (sinceYield >= 256 * 1024) {
        sinceYield = 0;
        await yieldToRequests();
      }
    }
    entries.reverse();
    await mkdir(dirname(path), { recursive: true, mode: 0o700 });
    // mkdirSync's mode only applies on creation — re-harden an existing config dir so the
    // conversation-content snapshot never lands in a group/world-readable directory.
    try { await chmod(dirname(path), 0o700); } catch { /* best-effort (e.g. Windows) */ }
    temp = `${path}.tmp-${process.pid}-${randomUUID()}`;
    await writeFile(temp, `{"version":1,"states":[${entries.join(",")}]}`, { flag: "wx", mode: 0o600 });
    // Windows scanners can briefly hold the destination. Retry asynchronously so streaming
    // and heartbeats can continue, keeping the existing atomic replacement guarantee.
    for (let attempt = 0; ; attempt++) {
      try { await rename(temp, path); break; } catch (error) {
        if (attempt >= 4 || !["EPERM", "EACCES", "EBUSY"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
        await delay(10 * (attempt + 1));
      }
    }
    temp = undefined;
    try { await chmod(path, 0o600); } catch { /* Windows ACLs are managed by the installer. */ }
  } catch {
    /* best-effort: disk trouble must never affect request handling */
  } finally {
    if (temp) await rm(temp, { force: true }).catch(() => {});
  }
}

function enqueuePersist(path: string): void {
  // Keep only the newest pending snapshot per destination while a slow disk is writing.
  // This avoids retaining an unbounded queue of obsolete conversation arrays.
  pendingSnapshots.set(path, [...states]);
  startPersistPump();
}

function startPersistPump(): void {
  if (persistRunning) return;
  persistRunning = true;
  persistChain = (async () => {
    while (pendingSnapshots.size) {
      const [path, snapshot] = pendingSnapshots.entries().next().value!;
      pendingSnapshots.delete(path);
      await persistSnapshot(path, snapshot);
    }
  })().finally(() => {
    persistRunning = false;
    if (pendingSnapshots.size) startPersistPump();
  });
}

function schedulePersist(): void {
  if (persistTimer) return;
  // Resolve the target path now: tests may swap CODEX_CHATGPT_WEB_HOME before the
  // debounce fires, and a late write must land in the home that owned the recorded state.
  pendingPersistPath = snapshotPath();
  const path = pendingPersistPath;
  persistTimer = setTimeout(() => {
    persistTimer = null;
    pendingPersistPath = null;
    enqueuePersist(path);
  }, SNAPSHOT_DEBOUNCE_MS);
  (persistTimer as { unref?: () => void }).unref?.();
}

/** Flush any pending debounced snapshot write (graceful shutdown / deterministic tests). */
export async function flushResponseState(): Promise<void> {
  for (;;) {
    if (persistTimer) {
      clearTimeout(persistTimer);
      persistTimer = null;
      const path = pendingPersistPath ?? snapshotPath();
      pendingPersistPath = null;
      enqueuePersist(path);
    }
    const pending = persistChain;
    await pending;
    if (!persistTimer && !pendingSnapshots.size && pending === persistChain) return;
  }
}

function inputItems(input: unknown): unknown[] {
  if (input === undefined) return [];
  if (Array.isArray(input)) return input;
  if (typeof input === "string") return [{ role: "user", content: input }];
  return [input];
}

function pruneResponses(at = now()): void {
  for (const [id, state] of states) {
    if (at - state.createdAt > RESPONSE_TTL_MS) deleteEntry(id);
  }
  while (states.size > MAX_STORED_RESPONSES) {
    const oldest = states.keys().next().value;
    if (!oldest) break;
    deleteEntry(oldest);
  }
  // Byte high-water eviction, oldest-first (Map preserves insertion order).
  while (storedResponseBytes > MAX_STORED_RESPONSE_BYTES && states.size > 1) {
    const oldest = states.keys().next().value;
    if (!oldest) break;
    deleteEntry(oldest);
  }
}

export function expandPreviousResponseInput(body: unknown): unknown {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const request = body as Record<string, unknown>;
  const previousId = typeof request.previous_response_id === "string" ? request.previous_response_id : undefined;
  if (!previousId) return body;
  ensureLoaded();
  pruneResponses();
  const previous = states.get(previousId);
  if (!previous) return body;
  const expanded = {
    ...request,
    input: [...previous.items, ...inputItems(request.input)],
  };
  replayedInputPrefixLengths.set(expanded, previous.items.length);
  bindPreparedResponseHistory(expanded, previous.items);
  return expanded;
}

/** Number of leading input items restored from previous_response_id state for this exact body. */
export function previousResponseReplayPrefixLength(body: unknown): number {
  if (!body || typeof body !== "object" || Array.isArray(body)) return 0;
  return replayedInputPrefixLengths.get(body) ?? 0;
}

/**
 * Cache completed output and max_output_tokens partial output for previous_response_id replay.
 * Content-filtered incomplete and failed output are not authoritative replay history.
 */
export function rememberResponseState(
  requestBody: unknown,
  response: { id?: unknown; output?: unknown; status?: unknown; incomplete_details?: unknown },
  opts?: { force?: boolean },
): void {
  if (!requestBody || typeof requestBody !== "object" || Array.isArray(requestBody)) return;
  const request = requestBody as Record<string, unknown>;
  // `force` bypasses only the store:false skip: Codex sends `store:false` on every non-Azure
  // HTTP request (and WS inherits it), yet its WS turns still chain with previous_response_id.
  // The passthrough branch records with force so those chains can be expanded locally; the
  // store stays in-memory with a 1h TTL, so this is a proxy-internal continuation cache, not
  // real server-side response storage.
  if (request.store === false && !opts?.force) return;
  if (typeof response.id !== "string" || !Array.isArray(response.output)) return;
  if (response.status === "incomplete") {
    const details = response.incomplete_details;
    if (!details || typeof details !== "object" || Array.isArray(details)
      || (details as { reason?: unknown }).reason !== "max_output_tokens") return;
  } else if (response.status !== undefined && response.status !== "completed") return;
  ensureLoaded();
  setEntry(response.id, {
    createdAt: now(),
    items: [...inputItems(request.input), ...response.output],
  });
  pruneResponses();
  const stored = states.get(response.id);
  if (stored) scheduleResponseHistoryPreparation(stored.items, stored.sizeBytes ?? Infinity, request);
  schedulePersist();
}
