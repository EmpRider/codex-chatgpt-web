import { expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { AgentResponsesAttemptJournal } from "../src/integrations/agent-responses/attempt-journal";
import { AGENT_RESPONSES_ACTIVITY_PREFIX, validateActivityEvent } from "../src/activity-events";

function resultLines(output: string): string {
  return output.trim().split(/\r?\n/).filter(line => {
    if (!line.startsWith(AGENT_RESPONSES_ACTIVITY_PREFIX)) return true;
    expect(validateActivityEvent(JSON.parse(line.slice(AGENT_RESPONSES_ACTIVITY_PREFIX.length)))).not.toBeNull();
    return false;
  }).join("\n");
}

const request = { model: "chatgpt-web/gpt-5.6-luna", input: "Synthetic edit; never run" };
const modulePath = resolve(import.meta.dir, "../src/integrations/agent-responses/attempt-journal.ts");

function child(directory: string, key: string) {
  return Bun.spawn([process.execPath, "-e", `import { AgentResponsesAttemptJournal } from ${JSON.stringify(modulePath)};
try { new AgentResponsesAttemptJournal(${JSON.stringify(directory)}).claim(${JSON.stringify(key)}, ${JSON.stringify(request)}); console.log('reserved'); }
catch (error) { console.log(error.status); }`], { stdout: "pipe", stderr: "pipe" });
}

test("a fresh process rejects an interrupted durable attempt", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent-crash-journal-"));
  try {
    const first = child(root, "interrupted_attempt_12345678");
    expect(await first.exited).toBe(0);
    expect((await new Response(first.stdout).text()).trim()).toBe("reserved");
    const second = child(root, "interrupted_attempt_12345678");
    expect(await second.exited).toBe(0);
    expect(resultLines(await new Response(second.stdout).text())).toBe("409");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("concurrent processes reserve a durable attempt exactly once", async () => {
  const root = mkdtempSync(join(tmpdir(), "agent-concurrent-journal-"));
  try {
    const children = [child(root, "same_request_12345678"), child(root, "same_request_12345678")];
    expect(await Promise.all(children.map(process => process.exited))).toEqual([0, 0]);
    const results = await Promise.all(children.map(async process => resultLines(await new Response(process.stdout).text())));
    expect(results.sort()).toEqual(["409", "reserved"]);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("durable marker capacity refuses new claims without forgetting previous attempts", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-journal-capacity-"));
  try {
    const journal = new AgentResponsesAttemptJournal(root);
    journal.claim("original_attempt_12345678", request);
    const database = new Database(join(root, "integrations", "agent-responses-attempts.sqlite"));
    try {
      database.exec(`WITH RECURSIVE entries(n) AS (SELECT 1 UNION ALL SELECT n+1 FROM entries WHERE n < 99999)
        INSERT INTO attempts SELECT printf('%064x', n), 'synthetic-digest', 'outcome_unknown' FROM entries`);
    } finally { database.close(); }
    expect(() => journal.claim("new_attempt_12345678", request)).toThrow("capacity exceeded");
    expect(() => journal.claim("original_attempt_12345678", request)).toThrow("automatic replay is unsafe");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test("lost storage after claim refuses state advancement", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-journal-lost-"));
  try {
    const attempt = new AgentResponsesAttemptJournal(root).claim("original_attempt_12345678", request)!;
    rmSync(join(root, "integrations"), { recursive: true });
    expect(() => attempt.advance("send_activated")).toThrow("marker missing");
  } finally { rmSync(root, { recursive: true, force: true }); }
});

for (const corrupt of [false, true]) test(`journal fails closed on ${corrupt ? "corrupt database" : "unavailable storage"}`, () => {
  const root = mkdtempSync(join(tmpdir(), "agent-journal-failure-"));
  try {
    if (corrupt) {
      mkdirSync(join(root, "integrations"));
      writeFileSync(join(root, "integrations", "agent-responses-attempts.sqlite"), "not a database");
    } else writeFileSync(join(root, "integrations"), "not a directory");
    expect(() => new AgentResponsesAttemptJournal(root).claim("blocked_attempt_12345678", request))
      .toThrow("storage unavailable");
  } finally { rmSync(root, { recursive: true, force: true }); }
});
