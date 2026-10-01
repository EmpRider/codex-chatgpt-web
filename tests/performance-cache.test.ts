import { expect, test } from "bun:test";
import { estimateTokens, tokenEstimateCacheStats, withTokenEstimateCache } from "../src/lib/token-estimate";

test("settled token caches release prompt entries inherited by detached async resources", async () => {
  for (const outcome of ["sync", "resolved", "rejected"] as const) {
    let release!: () => void;
    let detached!: Promise<void>;
    const work = () => {
      estimateTokens("private prompt");
      detached = new Promise<void>(resolve => { release = resolve; }).then(() => {
        expect(tokenEstimateCacheStats()).toBeUndefined();
        estimateTokens("another prompt");
        expect(tokenEstimateCacheStats()).toBeUndefined();
      });
      if (outcome === "rejected") return Promise.reject(new Error("request failed"));
      if (outcome === "resolved") return Promise.resolve("done");
      return "done";
    };
    if (outcome === "rejected") await expect(withTokenEstimateCache(work)).rejects.toThrow("request failed");
    else expect(await withTokenEstimateCache(work)).toBe("done");
    release();
    await detached;
  }
});
import { chatGptWebMcpContextChunkBatch, createChatGptWebMcpContextTransport } from "../src/adapters/chatgpt-web/context-transport";

test("token estimates are reused within one async request, with bounded retention", async () => {
  await withTokenEstimateCache(async () => {
    expect(estimateTokens("hello world")).toBe(2);
    await Promise.resolve();
    expect(estimateTokens("hello world", "another-model")).toBe(2);
    expect(tokenEstimateCacheStats()).toMatchObject({ hits: 1, misses: 1 });
    for (let i = 0; i < 200; i++) estimateTokens(`different text ${i}`);
    expect(tokenEstimateCacheStats()!.entries).toBeLessThanOrEqual(128);
    expect(tokenEstimateCacheStats()!.retainedBytes).toBeLessThanOrEqual(8 * 1024 * 1024);
  });
  expect(tokenEstimateCacheStats()).toBeUndefined();
  withTokenEstimateCache(() => {
    estimateTokens("hello world");
    expect(tokenEstimateCacheStats()).toMatchObject({ hits: 0, misses: 1 });
  });
});

test("concurrent token caches do not retain or count each other's prompts", async () => {
  await Promise.all([1, 2].map(async index => withTokenEstimateCache(async () => {
    estimateTokens(`private request ${index}`);
    await Promise.resolve();
    expect(tokenEstimateCacheStats()).toMatchObject({ entries: 1, hits: 0, misses: 1 });
  })));
});

test("cached MCP boundaries preserve Unicode and refresh when the source changes", () => {
  const text = "a".repeat(32767) + "😀" + "b".repeat(32767) + "😀";
  const context = createChatGptWebMcpContextTransport(text);
  const first = chatGptWebMcpContextChunkBatch(context, context.contextId, 0, 1);
  expect(first.text).toBe("a".repeat(32767));
  const next = chatGptWebMcpContextChunkBatch(context, context.contextId, 1, 5);
  expect(first.text + next.text).toBe(text);
  context.text = "replacement";
  expect(chatGptWebMcpContextChunkBatch(context, context.contextId, 0, 5).text).toBe("replacement");
});
