import { expect, test } from "bun:test";
import { MAX_CONCURRENT_NINE_ROUTER_BODY_READS, readJsonRequestBody } from "../src/http-body";

test("decodes Codex zstd-compressed JSON request bodies", async () => {
  const body = { model: "chatgpt-web/pro", reasoning: { effort: "ultra" }, input: [{ role: "user", content: "hello" }] };
  const compressed = Bun.zstdCompressSync(Buffer.from(JSON.stringify(body)));
  const encoded = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(encoded).set(compressed);
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "zstd" },
    body: encoded,
  });

  expect(await readJsonRequestBody(request)).toEqual(body);
});

test("rejects unsupported request content encodings", async () => {
  const request = new Request("http://127.0.0.1/v1/responses", {
    method: "POST",
    headers: { "content-type": "application/json", "content-encoding": "br" },
    body: "{}",
  });

  await expect(readJsonRequestBody(request)).rejects.toThrow("Unsupported Content-Encoding: br");
});

test("a stalled 9Router upload is bounded and cancels its unread transport", async () => {
  let transportCancelled = false;
  const input = new ReadableStream<Uint8Array>({
    pull: () => new Promise(() => {}),
    cancel: () => { transportCancelled = true; },
  });
  const request = new Request("http://127.0.0.1/integrations/9router/v1/responses", {
    method: "POST", headers: { "content-type": "application/json" },
    body: input, duplex: "half",
  } as RequestInit);
  await expect(readJsonRequestBody(request, { readTimeoutMs: 20 })).rejects.toMatchObject({ status: 408 });
  expect(transportCancelled).toBe(true);
});

test("bounded 9Router uploads preserve the native zstd JSON decoding contract", async () => {
  const body = { model: "chatgpt-web/gpt-5.6-luna", input: "Hello" };
  const compressed = Bun.zstdCompressSync(Buffer.from(JSON.stringify(body)));
  const encoded = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(encoded).set(compressed);
  const request = new Request("http://127.0.0.1/integrations/9router/v1/responses", {
    method: "POST", headers: { "content-encoding": "zstd" },
    body: encoded,
  });
  expect(await readJsonRequestBody(request, { readTimeoutMs: 1_000 })).toEqual(body);
});

test("malformed compressed 9Router input reports a client error, not a provider crash", async () => {
  const request = new Request("http://127.0.0.1/integrations/9router/v1/responses", {
    method: "POST", headers: { "content-encoding": "zstd" }, body: "not zstd",
  });
  await expect(readJsonRequestBody(request, { readTimeoutMs: 1_000 })).rejects.toMatchObject({ status: 400 });
});

test("oversized 9Router Content-Length fails before allocating a request-body buffer", async () => {
  const request = new Request("http://127.0.0.1/integrations/9router/v1/responses", {
    method: "POST", headers: { "content-length": String(65 * 1024 * 1024) }, body: "{}",
  });
  await expect(readJsonRequestBody(request, { readTimeoutMs: 1_000 })).rejects.toMatchObject({ status: 413 });
});

test("9Router streaming zstd decompression rejects a compressed expansion bomb", async () => {
  const data = Buffer.alloc(129 * 1024 * 1024, 65);
  const compressed = Bun.zstdCompressSync(data);
  const body = new ArrayBuffer(compressed.byteLength);
  new Uint8Array(body).set(compressed);
  const request = new Request("http://127.0.0.1/integrations/9router/v1/responses", {
    method: "POST", headers: { "content-encoding": "zstd" }, body,
  });
  await expect(readJsonRequestBody(request, { readTimeoutMs: 20_000 }))
    .rejects.toMatchObject({ status: 413 });
}, 30_000);

test("9Router caps concurrent body reads and releases admission after timeout", async () => {
  let cancelCount = 0;
  const blocked = Array.from({ length: MAX_CONCURRENT_NINE_ROUTER_BODY_READS }, () => {
    const body = new ReadableStream<Uint8Array>({
      pull: () => new Promise(() => {}),
      cancel: () => { cancelCount++; },
    });
    return readJsonRequestBody(new Request("http://127.0.0.1/9router", {
      method: "POST", body, duplex: "half",
    } as RequestInit), { readTimeoutMs: 40 });
  });
  const overflow = new Request("http://127.0.0.1/9router", { method: "POST", body: "{}" });
  await expect(readJsonRequestBody(overflow, { readTimeoutMs: 100 }))
    .rejects.toMatchObject({ status: 429 });
  const outcomes = await Promise.allSettled(blocked);
  expect(outcomes.map(outcome => outcome.status === "rejected" ? (outcome.reason as { status?: number }).status : "fulfilled"))
    .toEqual(Array(MAX_CONCURRENT_NINE_ROUTER_BODY_READS).fill(408));
  expect(cancelCount).toBe(MAX_CONCURRENT_NINE_ROUTER_BODY_READS);
  const admitted = new Request("http://127.0.0.1/9router", { method: "POST", body: "{}" });
  expect(await readJsonRequestBody(admitted, { readTimeoutMs: 100 })).toEqual({});
});
