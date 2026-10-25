import { expect, test } from "bun:test";
import { readJsonRequestBody } from "../src/http-body";

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

test("oversized 9Router Content-Length fails before allocating a request-body buffer", async () => {
  const request = new Request("http://127.0.0.1/integrations/9router/v1/responses", {
    method: "POST", headers: { "content-length": String(65 * 1024 * 1024) }, body: "{}",
  });
  await expect(readJsonRequestBody(request, { readTimeoutMs: 1_000 })).rejects.toMatchObject({ status: 413 });
});
