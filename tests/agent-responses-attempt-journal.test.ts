import { expect, spyOn, test } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgentResponsesAttemptJournal } from "../src/integrations/agent-responses/attempt-journal";

const body = { model: "chatgpt-web/gpt-5.6-luna", input: "PRIVATE synthetic write" };

test("journal logs durable transitions, conflicts and storage loss without private data", () => {
  const directory = mkdtempSync(join(tmpdir(), "journal-activity-"));
  const lines: string[] = [];
  const output = spyOn(process.stdout, "write").mockImplementation(((line: unknown) => {
    lines.push(String(line)); return true;
  }) as typeof process.stdout.write);
  try {
    const journal = new AgentResponsesAttemptJournal(directory);
    const attempt = journal.claim("private-request-key", body)!;
    attempt.advance("send_activated");
    expect(() => journal.claim("private-request-key", body)).toThrow();
    rmSync(join(directory, "integrations"), { recursive: true, force: true });
    expect(() => attempt.advance("browser_accepted")).toThrow();
    const events = lines.map(line => JSON.parse(line.slice("[agent-responses.activity] ".length)));
    expect(events).toContainEqual(expect.objectContaining({ event: "journal_advanced", code: "send_activated" }));
    expect(events).toContainEqual(expect.objectContaining({ event: "journal_failed", code: "conflict" }));
    expect(events).toContainEqual(expect.objectContaining({ event: "journal_storage_failed", code: "storage_failed" }));
    expect(lines.join("")).not.toContain("private-request-key");
    expect(lines.join("")).not.toContain("PRIVATE");
    expect(lines.join("")).not.toContain(directory);
  } finally { output.mockRestore(); rmSync(directory, { recursive: true, force: true }); }
});

test("keyed attempt persists only digests and rejects changed or repeated requests", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-responses-journal-"));
  try {
    const journal = new AgentResponsesAttemptJournal(directory);
    expect(journal.claim(null, body)).toBeUndefined();
    expect(readdirSync(directory)).toHaveLength(0);
    const attempt = journal.claim("operator-request-identity-123", body)!;
    attempt.advance("send_activated");
    expect(() => new AgentResponsesAttemptJournal(directory).claim("operator-request-identity-123", body))
      .toThrow("send_activated");
    expect(() => journal.claim("operator-request-identity-123", { ...body, input: "Different write" }))
      .toThrow("another request");
    const files = readdirSync(join(directory, "integrations"));
    expect(files).toContain("agent-responses-attempts.sqlite");
    for (const file of files) {
      const content = readFileSync(join(directory, "integrations", file)).toString();
      expect(content).not.toContain("PRIVATE");
      expect(content).not.toContain("operator-request-identity-123");
    }
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("invalid idempotency keys fail before touching storage", () => {
  const directory = mkdtempSync(join(tmpdir(), "agent-responses-journal-invalid-"));
  try {
    const journal = new AgentResponsesAttemptJournal(directory);
    for (const invalid of ["short", " spaces ", "invalid/../../path", "x".repeat(129)]) {
      expect(() => journal.claim(invalid, body)).toThrow();
    }
    expect(readdirSync(directory)).toHaveLength(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
