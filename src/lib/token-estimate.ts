import { get_encoding, type Tiktoken } from "tiktoken";
import { createHash } from "node:crypto";
import { AsyncLocalStorage } from "node:async_hooks";

/**
 * Token accounting for ChatGPT Web prompts.
 *
 * A character ratio is not safe here: dense JSON/base64 can contain far more tokens than prose
 * of the same length. Count with the tokenizer used by the GPT-5 generation instead.
 */

const TOKENIZER_CHUNK_CHARS = 4_096;
let tokenizer: Tiktoken | undefined;
const MAX_CACHE_BYTES = 8 * 1024 * 1024;
const MAX_CACHE_ENTRIES = 128;
interface EstimateCache {
  active: boolean;
  values: Map<string, number>;
  retainedBytes: number;
  hits: number;
  misses: number;
  sharedHits: number;
}
const requestCache = new AsyncLocalStorage<EstimateCache>();

// Retain only exact-content digests and counts across requests, never prompt strings.
// This process uses one fixed tokenizer/algorithm; process restart invalidates all entries.
const sharedEstimates = new Map<string, { count: number; expiresAt: number }>();
const SHARED_ESTIMATE_LIMIT = 1024;
const SHARED_ESTIMATE_TTL_MS = 5 * 60_000;

/** Keep request-local prompt retention scoped to the owning request. */
export function withTokenEstimateCache<T>(work: () => T): T {
  if (requestCache.getStore()?.active) return work();
  const cache: EstimateCache = { active: true, values: new Map(), retainedBytes: 0, hits: 0, misses: 0, sharedHits: 0 };
  const release = () => {
    // Async resources (including broker listeners and retained timers) can outlive
    // their request. They must not keep prompt strings or reuse its expired cache.
    cache.active = false;
    cache.values.clear();
    cache.retainedBytes = 0;
  };
  return requestCache.run(cache, () => {
    try {
      const result = work();
      if (result != null && (typeof result === "object" || typeof result === "function")
        && typeof (result as { then?: unknown }).then === "function") {
        return Promise.resolve(result).finally(release) as T;
      }
      release();
      return result;
    } catch (error) {
      release();
      throw error;
    }
  });
}

export function tokenEstimateCacheStats() {
  const cache = requestCache.getStore();
  return cache?.active ? { hits: cache.hits, misses: cache.misses, sharedHits: cache.sharedHits, entries: cache.values.size, retainedBytes: cache.retainedBytes } : undefined;
}

function chatGptTokenizer(): Tiktoken {
  tokenizer ??= get_encoding("o200k_base");
  return tokenizer;
}

/**
 * Count ordinary text conservatively without handing pathological multi-megabyte runs to one
 * tokenizer call. Independent chunks can only lose cross-boundary merges, so their sum may
 * over-count slightly but cannot under-count because of a missed boundary token.
 */
export function estimateTokens(text: string, modelId?: string): number {
  void modelId;
  if (!text) return 0;

  const inheritedCache = requestCache.getStore();
  const cache = inheritedCache?.active ? inheritedCache : undefined;
  const cached = cache?.values.get(text);
  if (cached !== undefined) {
    cache!.hits += 1;
    cache!.values.delete(text);
    cache!.values.set(text, cached);
    return cached;
  }
  if (cache) cache.misses += 1;

  // Small inputs cost less to tokenize than to hash; very large inputs bypass shared caching.
  const key = text.length >= 256 && text.length <= 2 * 1024 * 1024
    ? createHash("sha256").update(text, "utf16le").digest("hex") : undefined;
  const shared = key ? sharedEstimates.get(key) : undefined;
  let count: number;
  if (shared && shared.expiresAt > Date.now()) {
    count = shared.count;
    if (cache) cache.sharedHits += 1;
    sharedEstimates.delete(key!);
    sharedEstimates.set(key!, shared);
  } else {
    const encoding = chatGptTokenizer();
    count = 0;
    for (let start = 0; start < text.length;) {
      let end = Math.min(start + TOKENIZER_CHUNK_CHARS, text.length);
      if (end < text.length) {
        const previous = text.charCodeAt(end - 1);
        const next = text.charCodeAt(end);
        if (previous >= 0xD800 && previous <= 0xDBFF && next >= 0xDC00 && next <= 0xDFFF) {
          end -= 1;
        }
      }
      count += encoding.encode_ordinary(text.slice(start, end)).length;
      start = end;
    }
    if (key) {
      sharedEstimates.delete(key);
      while (sharedEstimates.size >= SHARED_ESTIMATE_LIMIT) {
        sharedEstimates.delete(sharedEstimates.keys().next().value!);
      }
      sharedEstimates.set(key, { count, expiresAt: Date.now() + SHARED_ESTIMATE_TTL_MS });
    }
  }
  // Charge two bytes per UTF-16 code unit even when the engine can use compact strings.
  const bytes = text.length * 2;
  if (cache && bytes <= MAX_CACHE_BYTES) {
    while (cache.values.size >= MAX_CACHE_ENTRIES || cache.retainedBytes + bytes > MAX_CACHE_BYTES) {
      const oldest = cache.values.keys().next().value;
      if (oldest === undefined) break;
      cache.retainedBytes -= oldest.length * 2;
      cache.values.delete(oldest);
    }
    cache.values.set(text, count);
    cache.retainedBytes += bytes;
  }
  return count;
}
