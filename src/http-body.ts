import { createZstdDecompress } from "node:zlib";
import { Readable } from "node:stream";

const MAX_ENCODED_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_REQUEST_BYTES = 128 * 1024 * 1024;
// Two maximal uploads can coexist without allowing unbounded concurrent
// encoded, decoded and parser allocations for the local Responses provider.
export const MAX_CONCURRENT_PROVIDER_BODY_READS = 2;
let activeProviderBodyReads = 0;

export class HttpBodyReadError extends Error {
  constructor(message: string, readonly status: 400 | 408 | 413 | 415 | 429) {
    super(message);
    this.name = "HttpBodyReadError";
  }
}

async function decompressBoundedZstd(encoded: Uint8Array, deadlineMs: number, signal: AbortSignal): Promise<Uint8Array> {
  const source = Readable.from([encoded]);
  const decoder = createZstdDecompress();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let cancelled = false;
  const cancel = (message: string) => {
    if (cancelled) return;
    cancelled = true;
    const error = new HttpBodyReadError(message, 408);
    // Readable.pipe() does not forward source errors to the decoder. Destroy the source
    // quietly; the decoder's async iterator owns the cancellation error.
    source.destroy();
    decoder.destroy(error);
  };
  const timer = setTimeout(() => cancel("Compressed request decoding exceeded its deadline"), deadlineMs);
  const abort = () => cancel("Compressed request decoding was cancelled");
  signal.addEventListener("abort", abort, { once: true });
  try {
    if (signal.aborted) throw new HttpBodyReadError("Compressed request decoding was cancelled", 408);
    for await (const chunk of source.pipe(decoder)) {
      const bytes = chunk as Buffer;
      total += bytes.byteLength;
      assertWithinLimit(total, MAX_DECODED_REQUEST_BYTES, "Decoded request body");
      chunks.push(bytes);
    }
    return Buffer.concat(chunks, total);
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    source.destroy();
    decoder.destroy();
  }
}

function assertWithinLimit(bytes: number, limit: number, label: string): void {
  if (bytes > limit) throw new HttpBodyReadError(`${label} exceeds ${limit} bytes`, 413);
}

/** The local Responses provider accepts untrusted HTTP bodies and must not allocate an
 * unlimited arrayBuffer for a peer that never finishes uploading its request.
 * Existing native Codex callers keep their current body-read path by default.
 */
async function readBoundedBody(request: Request, timeoutMs: number): Promise<Uint8Array> {
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let interrupt!: (error: Error) => void;
  const interrupted = new Promise<never>((_resolve, reject) => { interrupt = reject; });
  const cancel = (error: Error) => {
    interrupt(error);
    void reader.cancel(error).catch(() => {});
  };
  const onAbort = () => cancel(new HttpBodyReadError("Request body upload was cancelled", 408));
  const timer = setTimeout(() => cancel(new HttpBodyReadError("Request body upload exceeded its deadline", 408)), timeoutMs);
  request.signal.addEventListener("abort", onAbort, { once: true });
  try {
    if (request.signal.aborted) onAbort();
    for (;;) {
      const next = await Promise.race([reader.read(), interrupted]);
      if (next.done) break;
      total += next.value.byteLength;
      assertWithinLimit(total, MAX_ENCODED_REQUEST_BYTES, "Encoded request body");
      chunks.push(next.value);
    }
    const encoded = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { encoded.set(chunk, offset); offset += chunk.byteLength; }
    return encoded;
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  } finally {
    clearTimeout(timer);
    request.signal.removeEventListener("abort", onAbort);
  }
}

export async function readJsonRequestBody(request: Request, options?: { readTimeoutMs?: number }): Promise<unknown> {
  const bounded = options?.readTimeoutMs !== undefined;
  if (bounded && activeProviderBodyReads >= MAX_CONCURRENT_PROVIDER_BODY_READS) {
    throw new HttpBodyReadError("Too many concurrent provider body uploads", 429);
  }
  if (bounded) activeProviderBodyReads++;
  try {
    const startedAt = performance.now();
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength)) {
      assertWithinLimit(declaredLength, MAX_ENCODED_REQUEST_BYTES, "Encoded request body");
    }

    const encoded = options?.readTimeoutMs === undefined
      ? new Uint8Array(await request.arrayBuffer())
      : await readBoundedBody(request, options.readTimeoutMs);
    assertWithinLimit(encoded.byteLength, MAX_ENCODED_REQUEST_BYTES, "Encoded request body");

    const contentEncoding = (request.headers.get("content-encoding") ?? "identity").trim().toLowerCase();
    let decoded: Uint8Array;
    if (contentEncoding === "" || contentEncoding === "identity") {
      decoded = encoded;
    } else if (contentEncoding === "zstd") {
      try {
        decoded = bounded ? await decompressBoundedZstd(encoded,
          Math.max(1, options!.readTimeoutMs! - (performance.now() - startedAt)), request.signal)
          : await Bun.zstdDecompress(encoded);
      } catch (error) {
        if (error instanceof HttpBodyReadError) throw error;
        if (bounded) throw new HttpBodyReadError("Invalid zstd-compressed request body", 400);
        throw error;
      }
    } else {
      throw new HttpBodyReadError(`Unsupported Content-Encoding: ${contentEncoding}`, 415);
    }
    assertWithinLimit(decoded.byteLength, MAX_DECODED_REQUEST_BYTES, "Decoded request body");

    const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
    return JSON.parse(text) as unknown;
  } finally {
    if (bounded) activeProviderBodyReads--;
  }
}
