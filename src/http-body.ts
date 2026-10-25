const MAX_ENCODED_REQUEST_BYTES = 64 * 1024 * 1024;
const MAX_DECODED_REQUEST_BYTES = 128 * 1024 * 1024;

export class HttpBodyReadError extends Error {
  constructor(message: string, readonly status: 408 | 413 | 415) {
    super(message);
    this.name = "HttpBodyReadError";
  }
}

function assertWithinLimit(bytes: number, limit: number, label: string): void {
  if (bytes > limit) throw new HttpBodyReadError(`${label} exceeds ${limit} bytes`, 413);
}

/** The 9Router sidecar accepts untrusted HTTP bodies and must not allocate an
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
    decoded = await Bun.zstdDecompress(encoded);
  } else {
    throw new HttpBodyReadError(`Unsupported Content-Encoding: ${contentEncoding}`, 415);
  }
  assertWithinLimit(decoded.byteLength, MAX_DECODED_REQUEST_BYTES, "Decoded request body");

  const text = new TextDecoder("utf-8", { fatal: true }).decode(decoded);
  return JSON.parse(text) as unknown;
}
