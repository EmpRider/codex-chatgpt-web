// Synthetic parser microbenchmark; this does not measure browser/model/tool latency.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setImmediate } from "node:timers/promises";
import { parseRequest } from "../src/responses/parser";
import {
  rememberResponseState, expandPreviousResponseInput, preparedResponseHistoryStats, flushResponseState,
} from "../src/responses/state";

const home = mkdtempSync(join(tmpdir(), "cgw-prepared-bench-"));
process.env.CODEX_CHATGPT_WEB_HOME = home;
const input = Array.from({ length: 160 }, (_, index) => [
  { role: "user", content: `request ${index}` },
  {
    type: "function_call", call_id: `c${index}`, name: "read",
    arguments: JSON.stringify({ path: `file-${index}`, options: "x".repeat(600) }),
  },
  { type: "function_call_output", call_id: `c${index}`, output: "result ".repeat(180) },
]).flat();

function measure(body: unknown) {
  const samples: number[] = [];
  for (let index = 0; index < 30; index++) {
    const start = performance.now();
    parseRequest(body);
    samples.push(performance.now() - start);
  }
  samples.sort((left, right) => left - right);
  return { medianMs: samples[15], p95Ms: samples[28] };
}

try {
  rememberResponseState({ input }, { id: "benchmark-prepared", output: [] });
  for (let index = 0; index < 8; index++) await setImmediate();
  const body = expandPreviousResponseInput({ model: "test", previous_response_id: "benchmark-prepared", input: "next" });
  // A JSON-equivalent body without private replay provenance takes the full parser path.
  const cold = structuredClone(body);
  for (let index = 0; index < 5; index++) {
    parseRequest(body);
    parseRequest(cold);
  }
  console.log(JSON.stringify({
    inputBytes: Buffer.byteLength(JSON.stringify(input)),
    cold: measure(cold), prepared: measure(body), cache: preparedResponseHistoryStats(),
  }));
} finally {
  await flushResponseState();
  rmSync(home, { recursive: true, force: true });
}
