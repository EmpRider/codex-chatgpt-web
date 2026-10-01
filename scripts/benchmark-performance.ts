import { estimateTokens, tokenEstimateCacheStats, withTokenEstimateCache } from "../src/lib/token-estimate";
import { chatGptWebMcpContextChunkBatch, chatGptWebMcpContextChunks, createChatGptWebMcpContextTransport } from "../src/adapters/chatgpt-web/context-transport";

// Local algorithm benchmark: excludes ChatGPT generation, browser, network and Windows RAM.
const text = "word ".repeat(100_000);
estimateTokens("warmup");
const measure = (work: () => void, rounds = 3) => {
  const start = performance.now();
  for (let index = 0; index < rounds; index++) work();
  return (performance.now() - start) / rounds;
};
const uncachedMs = measure(() => { for (let i = 0; i < 8; i++) estimateTokens(text); });
let stats: ReturnType<typeof tokenEstimateCacheStats>;
const cachedMs = measure(() => withTokenEstimateCache(() => {
  for (let i = 0; i < 8; i++) estimateTokens(text);
  stats = tokenEstimateCacheStats();
}));
console.log(JSON.stringify({ benchmark: "eight exact token counts for a 500k-character request", uncachedMs, cachedMs, speedup: uncachedMs / cachedMs, cache: stats! }));

const context = createChatGptWebMcpContextTransport("x".repeat(8 * 1024 * 1024));
const chunks = chatGptWebMcpContextChunks(context).length;
const legacyMs = measure(() => {
  for (let chunk = 0; chunk < chunks; chunk += 5) chatGptWebMcpContextChunks(context).slice(chunk, chunk + 5).join("");
}, 100);
const batchMs = measure(() => {
  for (let chunk = 0; chunk < chunks; chunk += 5) chatGptWebMcpContextChunkBatch(context, context.contextId, chunk, 5);
}, 100);
console.log(JSON.stringify({ benchmark: "8 MiB MCP batch selection; legacy replay uses all-chunk slicing", legacyMs, batchMs, speedup: legacyMs / batchMs, chunks, reads: Math.ceil(chunks / 5) }));
