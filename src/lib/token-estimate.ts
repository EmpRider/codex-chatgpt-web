import { get_encoding, type Tiktoken } from "tiktoken";
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
  values: Map<string, number>;
  retainedBytes: number;
  hits: number;
  misses: number;
}
const requestCache = new AsyncLocalStorage<EstimateCache>();

/** Cache exact text only for the owning request, never across conversations. */
export function withTokenEstimateCache<T>(work: () => T): T {
  if (requestCache.getStore()) return work();
  return requestCache.run({ values: new Map(), retainedBytes: 0, hits: 0, misses: 0 }, work);
}

export function tokenEstimateCacheStats() {
  const cache = requestCache.getStore();
  return cache && { hits: cache.hits, misses: cache.misses, entries: cache.values.size, retainedBytes: cache.retainedBytes };
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

  const cache = requestCache.getStore();
  const cached = cache?.values.get(text);
  if (cached !== undefined) {
    cache!.hits += 1;
    cache!.values.delete(text);
    cache!.values.set(text, cached);
    return cached;
  }
  if (cache) cache.misses += 1;

  const encoding = chatGptTokenizer();
  let count = 0;
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
