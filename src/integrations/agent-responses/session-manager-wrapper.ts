import { AgentResponsesSessionManager } from "./session-manager";
import type { TurnBroker } from "../../adapters/chatgpt-web/turn-broker";
import type { CodexProviderConfig } from "../../types";

// ponytail: ceiling is MCP transport timeout + delivery P99; upgrade when broker exposes per-call lease renewal.
const AGENT_RESPONSES_OWNER_LEASE_MS = 5 * 60_000;

export class AgentResponsesSessionManagerWithExtendedLease extends AgentResponsesSessionManager {
  constructor(broker: TurnBroker, provider: CodexProviderConfig) {
    super(broker, provider, undefined, AGENT_RESPONSES_OWNER_LEASE_MS);
  }
}