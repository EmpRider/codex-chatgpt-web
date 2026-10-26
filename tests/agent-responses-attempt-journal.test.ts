import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const journalModulePath = "../src/integrations/agent-responses/attempt-journal";
type Journal = { claim(key: string | null, body: unknown): { advance(state: string): void } | undefined };
type JournalCtor = new () => Journal;

async function journalConstructor(): Promise<JournalCtor> {
  const module = await import(journalModulePath).catch(() => null) as { AgentResponsesAttemptJournal?: JournalCtor } | null;
  expect(typeof module?.AgentResponsesAttemptJournal).toBe("function");
  return module!.AgentResponsesAttemptJournal!;
}

test("keyed attempt prevents live-process replay without writing a journal", async () => {
  const Journal = await journalConstructor();
  const directory = mkdtempSync(join(tmpdir(), "agent-responses-journal-"));
  const key = "operator-request-identity-123";
  const body = { model: "chatgpt-web/gpt-5.6-luna", input: "Do a write" };
  try {
    const journal = new Journal();
    expect(journal.claim(null, body)).toBeUndefined();
    const attempt = journal.claim(key, body);
    expect(attempt).toBeDefined();
    attempt!.advance("send_activated");
    expect(readdirSync(directory)).toHaveLength(0);
    expect(() => new Journal().claim(key, body)).toThrow("send_activated");
    expect(() => new Journal().claim(key, { ...body, input: "Different write" })).toThrow("another request");
    expect(existsSync(join(directory, "integrations"))).toBe(false);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});

test("invalid idempotency keys fail before reserving any unsafe attempt", async () => {
  const Journal = await journalConstructor();
  const directory = mkdtempSync(join(tmpdir(), "agent-responses-journal-invalid-"));
  try {
    const journal = new Journal();
    for (const invalid of ["short", " spaces ", "invalid/../../path", "x".repeat(129)]) {
      expect(() => journal.claim(invalid, { input: "Side effect" })).toThrow();
    }
    expect(readdirSync(directory)).toHaveLength(0);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
