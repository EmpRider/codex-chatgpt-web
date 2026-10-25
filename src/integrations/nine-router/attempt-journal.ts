import { createHash } from "node:crypto";
import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../../config";
import { NineRouterRequestError } from "./errors";

/** An attempt is evidence of possible execution, never permission to replay a browser Send. */
export type NineRouterAttemptState = "send_possible" | "send_activated" | "browser_accepted"
  | "tool_handoff_possible" | "tools_pending" | "response_prepared" | "outcome_unknown";

interface AttemptRecord {
  version: 1;
  fingerprint: string;
  state: NineRouterAttemptState;
  createdAt: number;
  updatedAt: number;
}

const MAX_ATTEMPT_RECORDS = 10_000;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

export class NineRouterAttemptJournal {
  constructor(private readonly directory = join(getConfigDir(), "integrations", "nine-router-attempts")) {}

  /** No header: legacy clients retain fail-closed disconnect behavior, but cannot deduplicate retries. */
  claim(rawKey: string | null, body: unknown): { advance: (state: NineRouterAttemptState) => void } | undefined {
    if (rawKey === null) return undefined;
    if (!KEY_PATTERN.test(rawKey)) {
      throw new NineRouterRequestError("Idempotency-Key must contain 8-128 ASCII letters, digits, dots, hyphens or underscores", 400);
    }
    // The sidecar has exactly one local authenticated operator. Scope by installation,
    // not the rotating API key, so key rotation cannot bypass an old attempt marker.
    const keyHash = createHash("sha256").update("9router-idempotency-v1\0").update(rawKey).digest("hex");
    // Exact JSON serialization deliberately fails closed if equivalent requests use different
    // key ordering. Guessing canonical equivalence could accidentally bind different operations.
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const path = join(this.directory, `${keyHash}.json`);
    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      if (!existsSync(path) && readdirSync(this.directory).filter(name => name.endsWith(".json")).length >= MAX_ATTEMPT_RECORDS) {
        throw new NineRouterRequestError("9Router attempt journal is full; archive it before accepting more requests", 507);
      }
      // Exclusive creation is the cross-process concurrency lock for this key. A crash during
      // the first write leaves an unreadable file; future attempts must fail closed.
      const fd = openSync(path, "wx", 0o600);
      const now = Date.now();
      const record: AttemptRecord = { version: 1, fingerprint, state: "send_possible", createdAt: now, updatedAt: now };
      try { writeFileSync(fd, JSON.stringify(record)); fsyncSync(fd); }
      finally { closeSync(fd); }
      return {
        advance: state => {
          if (record.state === state) return;
          record.state = state;
          record.updatedAt = Date.now();
          try { atomicWriteFile(path, JSON.stringify(record), { durable: true }); }
          catch { throw new NineRouterRequestError("Could not persist 9Router attempt status; execution outcome is uncertain", 507); }
        },
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "EEXIST" && existsSync(path)) {
        let prior: AttemptRecord;
        try { prior = JSON.parse(readFileSync(path, "utf8")) as AttemptRecord; }
        catch { throw new NineRouterRequestError("Existing 9Router attempt record is unreadable; retry is unsafe", 409); }
        if (prior.version !== 1 || typeof prior.fingerprint !== "string") {
          throw new NineRouterRequestError("Existing 9Router attempt record is invalid; retry is unsafe", 409);
        }
        if (prior.fingerprint !== fingerprint) {
          throw new NineRouterRequestError("Idempotency-Key was already used for a different request", 409);
        }
        throw new NineRouterRequestError(`9Router request was already attempted (${prior.state}); response replay is not acknowledged by the client`, 409);
      }
      if (error instanceof NineRouterRequestError) throw error;
      throw new NineRouterRequestError("Cannot durably reserve a 9Router attempt; browser submission was not started", 507);
    }
  }
}
