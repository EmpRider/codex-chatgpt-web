import { createHash } from "node:crypto";
import { AgentResponsesRequestError } from "./request";

export type AgentResponsesAttemptState = "send_possible" | "send_activated" | "browser_accepted"
  | "tool_handoff_possible" | "tools_pending" | "response_prepared" | "outcome_unknown";

interface AttemptRecord {
  fingerprint: string;
  state: AgentResponsesAttemptState;
}

const MAX_RECORDS = 100_000;
const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{7,127}$/;

// Markers are scoped to a running application. The external client owns retries after exit.
// Sharing this Map blocks keyed replays across provider instances in the same process.
const liveAttempts = new Map<string, AttemptRecord>();

export class AgentResponsesAttemptJournal {
  claim(rawKey: string | null, body: unknown): { advance(state: AgentResponsesAttemptState): void } | undefined {
    if (rawKey === null) return undefined;
    if (!KEY_PATTERN.test(rawKey)) {
      throw new AgentResponsesRequestError("Idempotency-Key requires 8-128 ASCII letters, digits, dots, hyphens or underscores", 400);
    }
    const keyHash = createHash("sha256").update("agent-responses-idempotency-v1\0").update(rawKey).digest("hex");
    const fingerprint = createHash("sha256").update(JSON.stringify(body)).digest("hex");
    const prior = liveAttempts.get(keyHash);
    if (prior) {
      if (prior.fingerprint !== fingerprint) {
        throw new AgentResponsesRequestError("Idempotency-Key was already used for another request", 409);
      }
      throw new AgentResponsesRequestError(`Request was already attempted (${prior.state}); automatic replay is unsafe`, 409);
    }
    if (liveAttempts.size >= MAX_RECORDS) throw new AgentResponsesRequestError("Too many live-process request markers", 429);
    const record: AttemptRecord = { fingerprint, state: "send_possible" };
    liveAttempts.set(keyHash, record);
    return { advance: state => { record.state = state; } };
  }
}
