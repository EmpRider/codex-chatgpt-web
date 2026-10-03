import { createHash } from "node:crypto";
import type { CodexMessage, CodexThinkingContent } from "../types";

/** Parser state at an input boundary, including reasoning that belongs to the next assistant. */
export interface PreparedConversation {
  messages: CodexMessage[];
  systemPrompt: string[];
  pendingReasoning: Array<{ part: CodexThinkingContent; envelopeSigned: boolean }>;
  loadedToolSpecs: unknown[];
  toolCallIndex: Map<string, { messageIndex: number; name: string; namespace?: string }>;
  compactionRequest: boolean;
  opaqueMultiAgentV2Payload: boolean;
}

type PreparedEntry = { state: PreparedConversation; digest: string; bytes: number; expiresAt: number };
const ready = new Map<unknown[], PreparedEntry>();
const pending = new Map<unknown[], { source?: unknown[] }>();
const sources = new WeakMap<object, unknown[]>();
const MAX_ENTRY_BYTES = 1024 * 1024;
const MAX_READY_BYTES = 4 * 1024 * 1024;
const MAX_READY_ENTRIES = 8;
const MAX_PENDING_ENTRIES = 4;
const TTL_MS = 5 * 60_000;
let retainedBytes = 0;
let hits = 0;
let misses = 0;
let prepare: ((items: unknown[], seed?: PreparedConversation) => PreparedConversation) | undefined;
let scheduled: ReturnType<typeof setImmediate> | undefined;

export function registerResponseHistoryPreparer(fn: (items: unknown[], seed?: PreparedConversation) => PreparedConversation): void {
  prepare = fn;
}

export function preparedResponseHistoryStats() {
  return { hits, misses, entries: ready.size, pending: pending.size, retainedBytes };
}

export function forgetResponseHistory(items: unknown[]): void {
  pending.delete(items);
  const previous = ready.get(items);
  if (previous) retainedBytes -= previous.bytes;
  ready.delete(items);
}

export function bindPreparedResponseHistory(body: object, items: unknown[]): void {
  sources.set(body, items);
}

function digest(text: string): string {
  return createHash("sha256").update(text, "utf16le").digest("hex");
}

function pump(): void {
  if (scheduled || !pending.size) return;
  scheduled = setImmediate(() => {
    scheduled = undefined;
    const items = pending.keys().next().value;
    if (!items) return;
    const source = pending.get(items)?.source;
    pending.delete(items);
    try {
      // Preparation is optional and bounded. Invalid/oversized history uses the normal parser.
      const serialized = JSON.stringify(items);
      if (serialized.length * 2 <= MAX_ENTRY_BYTES && prepare) {
        let seed: PreparedConversation | undefined;
        if (source) {
          const body = { input: items };
          bindPreparedResponseHistory(body, source);
          seed = preparedResponseHistory(body);
        }
        const state = prepare(seed && source ? items.slice(source.length) : items, seed);
        const bytes = serialized.length * 2 + JSON.stringify(state).length * 2 + state.toolCallIndex.size * 128;
        if (bytes <= MAX_READY_BYTES) {
          forgetResponseHistory(items);
          while (ready.size >= MAX_READY_ENTRIES || retainedBytes + bytes > MAX_READY_BYTES) {
            forgetResponseHistory(ready.keys().next().value!);
          }
          ready.set(items, { state, bytes, digest: digest(serialized), expiresAt: Date.now() + TTL_MS });
          retainedBytes += bytes;
        }
      }
    } catch { /* Never fail a completed response because optional preparation failed. */ }
    pump(); // Yield between histories so queued requests and streaming can run.
  });
  scheduled.unref?.();
}

export function scheduleResponseHistoryPreparation(items: unknown[], sizeBytes: number, requestBody?: object): void {
  if (!prepare || sizeBytes > MAX_ENTRY_BYTES) return;
  while (pending.size >= MAX_PENDING_ENTRIES) pending.delete(pending.keys().next().value!);
  pending.set(items, { source: requestBody ? sources.get(requestBody) : undefined });
  pump();
}

export function preparedResponseHistory(body: unknown): PreparedConversation | undefined {
  if (!body || typeof body !== "object") return undefined;
  const source = sources.get(body);
  if (!source) return undefined;
  const entry = ready.get(source);
  const input = (body as { input?: unknown }).input;
  if (entry && entry.expiresAt <= Date.now()) forgetResponseHistory(source);
  if (entry && entry.expiresAt > Date.now() && Array.isArray(input) && input.length >= source.length) {
    // Expanded raw bodies are mutable for existing adapters. Verify actual replayed bytes before
    // bypassing prefix validation; a caller cannot forge trust using previous_response_id alone.
    try {
      if (digest(JSON.stringify(input.slice(0, source.length))) === entry.digest) {
        hits += 1;
        ready.delete(source);
        ready.set(source, entry);
        return structuredClone(entry.state); // Adapters may mutate/compress their own projection.
      }
    } catch { /* Malformed or non-JSON input is handled by the normal validator. */ }
  }
  misses += 1;
  return undefined;
}
