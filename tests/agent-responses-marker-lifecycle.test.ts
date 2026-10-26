import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentResponsesAttemptJournal } from "../src/integrations/agent-responses/attempt-journal";

const request = { model: "chatgpt-web/gpt-5.6-luna", input: "Synthetic edit; never run" };

test("interrupted in-memory attempt rejects replay during the same app run", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-crash-journal-"));
  try {
    const initial = new AgentResponsesAttemptJournal();
    expect(initial.claim(null, request)).toBeUndefined();
    expect(readdirSync(directory)).toHaveLength(0);
    initial.claim("interrupted_attempt_12345678", request);
    expect(readdirSync(directory)).toHaveLength(0);
    expect(() => new AgentResponsesAttemptJournal().claim("interrupted_attempt_12345678", request))
      .toThrow("automatic replay is unsafe");
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("simultaneous reservations reject the second key without filesystem dependencies", () => {
  const root = mkdtempSync(join(tmpdir(), "agent-concurrent-journal-"));
  try {
    const dir = join(root, "journal");
    const journals = [new AgentResponsesAttemptJournal(), new AgentResponsesAttemptJournal()];
    const outcomes = journals.map(journal => {
      try { journal.claim("same_request_12345678", request); return "reserved"; }
      catch (error) { return (error as { status?: number }).status; }
    });
    expect(outcomes).toEqual(["reserved", 409]);
    const inaccessible = join(root, "existing-file-not-directory");
    writeFileSync(inaccessible, "not a directory");
    expect(() => new AgentResponsesAttemptJournal().claim("another_request_12345678", request))
      .not.toThrow();
    expect(existsSync(dir)).toBe(false);
  } finally { rmSync(root, { recursive: true, force: true }); }
});
