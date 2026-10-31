import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmodSync, lstatSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../../config";
import { AgentResponsesRequestError } from "./request";
import { reportAgentResponsesActivity } from "../../activity-events";

export type AgentResponsesAttemptState = "send_possible" | "send_activated" | "browser_accepted"
  | "tool_handoff_possible" | "tools_pending" | "response_prepared" | "outcome_unknown";

interface AttemptRecord {
  fingerprint: string;
  state: AgentResponsesAttemptState;
}

const MAX_RECORDS = 100_000;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

function withJournal<T>(configDir: string, action: (database: Database) => T): T {
  let database: Database | undefined;
  try {
    const directory = join(configDir, "integrations");
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    if (lstatSync(directory).isSymbolicLink()) throw new Error("Journal directory is a symbolic link");
    const path = join(directory, "agent-responses-attempts.sqlite");
    try {
      const entry = lstatSync(path);
      if (!entry.isFile() || entry.isSymbolicLink()) throw new Error("Journal must be a regular file");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    database = new Database(path, { create: true, strict: true });
    if (process.platform !== "win32") chmodSync(path, 0o600);
    database.exec("PRAGMA busy_timeout = 5000; PRAGMA synchronous = FULL;");
    database.exec(`CREATE TABLE IF NOT EXISTS attempts (
      key_hash TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL
    )`);
    return action(database);
  } catch (error) {
    const status = error instanceof AgentResponsesRequestError ? error.status : 503;
    reportAgentResponsesActivity({ level: status === 409 ? "WARN" : "ERROR", category: "journal",
      event: status === 503 ? "journal_storage_failed" : "journal_failed", phase: "journal",
      code: status === 409 ? "conflict" : status === 507 ? "capacity" : "storage_failed" });
    if (error instanceof AgentResponsesRequestError) throw error;
    throw new AgentResponsesRequestError("Generic Responses attempt storage unavailable; execution refused", 503);
  } finally { database?.close(); }
}

export class AgentResponsesAttemptJournal {
  constructor(private readonly configDir = getConfigDir()) {}

  claim(rawKey: string | null, body: unknown): { advance(state: AgentResponsesAttemptState): void } | undefined {
    if (rawKey === null) return undefined;
    if (!KEY_PATTERN.test(rawKey)) {
      throw new AgentResponsesRequestError("Idempotency-Key requires 8-128 ASCII letters, digits, dots, hyphens or underscores", 400);
    }
    const keyHash = createHash("sha256").update("agent-responses-idempotency-v1\0").update(rawKey).digest("hex");
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    withJournal(this.configDir, database => database.transaction(() => {
      const prior = database.query<AttemptRecord, [string]>("SELECT fingerprint, state FROM attempts WHERE key_hash = ?").get(keyHash);
      if (prior) {
        if (prior.fingerprint !== fingerprint) {
          throw new AgentResponsesRequestError("Idempotency-Key was already used for another request", 409);
        }
        throw new AgentResponsesRequestError(`Request was already attempted (${prior.state}); automatic replay is unsafe`, 409);
      }
      // ponytail: retain at most 100000 attempts; require operator archival, never automatically erase replay evidence.
      const count = database.query<{ count: number }, []>("SELECT COUNT(*) AS count FROM attempts").get()!.count;
      if (count >= MAX_RECORDS) throw new AgentResponsesRequestError("Durable request marker capacity exceeded", 507);
      database.query("INSERT INTO attempts (key_hash, fingerprint, state) VALUES (?, ?, 'send_possible')").run(keyHash, fingerprint);
    }).immediate());
    return { advance: state => {
      withJournal(this.configDir, database => {
        const updated = database.query("UPDATE attempts SET state = ? WHERE key_hash = ? AND fingerprint = ?")
          .run(state, keyHash, fingerprint);
        if (updated.changes !== 1) throw new AgentResponsesRequestError("Generic Responses attempt storage unavailable; marker missing", 503);
      });
      reportAgentResponsesActivity({ level: "DEBUG", category: "journal", event: "journal_advanced", phase: "journal", code: state });
    } };
  }
}
