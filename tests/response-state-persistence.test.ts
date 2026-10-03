import { afterAll, beforeEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandPreviousResponseInput, flushResponseState, rememberResponseState } from "../src/responses/state";

const home = mkdtempSync(join(tmpdir(), "cgw-async-state-"));
const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
// Other suites share the response-state module and may leave a debounce pending.
// Drain its captured destination before this suite changes the configuration home.
beforeEach(async () => { await flushResponseState(); });
afterAll(async () => {
  await flushResponseState();
  if (previousHome === undefined) delete process.env.CODEX_CHATGPT_WEB_HOME;
  else process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  rmSync(home, { recursive: true, force: true });
});

test("asynchronous snapshot flush preserves chained input and the original scheduled destination", async () => {
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  rememberResponseState({ input: "first", store: true }, { id: "perf-response-1", status: "completed", output: [{ role: "assistant", content: "answer" }] });
  const expanded = expandPreviousResponseInput({ previous_response_id: "perf-response-1", input: "second", store: true });
  rememberResponseState(expanded, { id: "perf-response-2", status: "completed", output: [{ role: "assistant", content: "answer 2" }] });
  process.env.CODEX_CHATGPT_WEB_HOME = join(home, "other");
  const pending = flushResponseState();
  expect(pending).toBeInstanceOf(Promise);
  await pending;
  const snapshot = JSON.parse(readFileSync(join(home, "responses-state.json"), "utf8"));
  expect(snapshot.states.find(([id]: [string]) => id === "perf-response-2")[1].items).toEqual([
    { role: "user", content: "first" }, { role: "assistant", content: "answer" },
    { role: "user", content: "second" }, { role: "assistant", content: "answer 2" },
  ]);
});

test("snapshot entry caps measure UTF-8 bytes and preserve oversized live continuations", async () => {
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  rememberResponseState({ input: "界".repeat(800_000), store: true }, { id: "perf-unicode", status: "completed", output: [] });
  await flushResponseState();
  const snapshot = JSON.parse(readFileSync(join(home, "responses-state.json"), "utf8"));
  expect(snapshot.states.some(([id]: [string]) => id === "perf-unicode")).toBe(false);
  expect((expandPreviousResponseInput({ previous_response_id: "perf-unicode", input: "next" }) as any).input[0].content).toHaveLength(800_000);
});

test("large snapshots yield to other work, concurrent flushes keep the newest state, and restart replay survives", async () => {
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  for (let index = 0; index < 8; index++) {
    rememberResponseState({ input: "snapshot text ".repeat(40_000), store: true }, { id: `perf-large-${index}`, output: [] });
  }
  let completed = false;
  const first = flushResponseState().then(() => { completed = true; });
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(completed).toBe(false);
  rememberResponseState({ input: "newest", store: true }, { id: "perf-newest", output: [] });
  await Promise.all([first, flushResponseState()]);
  const child = Bun.spawnSync([process.execPath, "-e", `
    import {expandPreviousResponseInput} from "./src/responses/state";
    console.log(JSON.stringify(expandPreviousResponseInput({previous_response_id:"perf-newest",input:"after restart"})));
  `], { cwd: join(import.meta.dir, ".."), env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home } });
  expect(child.exitCode).toBe(0);
  expect(JSON.parse(child.stdout.toString()).input).toEqual([
    { role: "user", content: "newest" }, { role: "user", content: "after restart" },
  ]);
});
