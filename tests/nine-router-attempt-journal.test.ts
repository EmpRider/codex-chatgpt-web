import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NineRouterAttemptJournal } from "../src/integrations/nine-router/attempt-journal";

const payload = { model: "chatgpt-web/gpt-5.6-luna", input: "edit a file" };

test("journal atomically reserves an idempotency key and rejects live or restarted duplicates", () => {
  const dir = mkdtempSync(join(tmpdir(), "r9-journal-"));
  try {
    const first = new NineRouterAttemptJournal(dir);
    const attempt = first.claim("attempt_12345678", payload)!;
    expect(attempt).toBeDefined();
    const contents = readFileSync(join(dir, readdirSync(dir)[0]!), "utf8");
    expect(contents).not.toContain("edit a file");
    expect(contents).not.toContain("attempt_12345678");
    attempt.advance("send_activated");
    attempt.advance("browser_accepted");
    const restarted = new NineRouterAttemptJournal(dir);
    expect(() => restarted.claim("attempt_12345678", payload)).toThrow("already attempted (browser_accepted)");
    expect(() => restarted.claim("attempt_12345678", { ...payload, input: "delete file" }))
      .toThrow("different request");
    expect(readdirSync(dir)).toHaveLength(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("journal fails closed on a partially written crash record; legacy calls remain optional", () => {
  const dir = mkdtempSync(join(tmpdir(), "r9-journal-"));
  try {
    const journal = new NineRouterAttemptJournal(dir);
    expect(journal.claim(null, payload)).toBeUndefined();
    expect(readdirSync(dir)).toHaveLength(0);
    expect(() => journal.claim("bad", payload)).toThrow("Idempotency-Key");
    journal.claim("attempt_abcdefgh", payload);
    writeFileSync(join(dir, readdirSync(dir)[0]!), "{partial", { mode: 0o600 });
    expect(() => new NineRouterAttemptJournal(dir).claim("attempt_abcdefgh", payload))
      .toThrow("unreadable; retry is unsafe");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("journal rejects concurrent claims and inaccessible storage without attempting work", () => {
  const dir = mkdtempSync(join(tmpdir(), "r9-journal-"));
  try {
    const first = new NineRouterAttemptJournal(join(dir, "journal"));
    const second = new NineRouterAttemptJournal(join(dir, "journal"));
    const results = [first, second].map(journal => {
      try { journal.claim("simultaneous_1234", payload); return "reserved"; }
      catch (error) { return (error as { status?: number }).status; }
    });
    expect(results).toEqual(["reserved", 409]);
    const invalidDirectory = join(dir, "occupied-file");
    writeFileSync(invalidDirectory, "not a directory");
    expect(() => new NineRouterAttemptJournal(invalidDirectory).claim("another_12345678", payload))
      .toThrow("Cannot durably reserve");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
