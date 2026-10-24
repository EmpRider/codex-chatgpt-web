import { createHash, randomUUID } from "node:crypto";

/** The provider log schema deliberately has no free-form messages, payloads or headers. */
export type NineRouterDiagnosticStage =
  | "auth_rejected" | "parse_rejected" | "model_rejected" | "request_started"
  | "browser_started" | "tool_batch_delivered" | "tool_results_returned"
  | "browser_finished" | "session_retired" | "request_failed" | "prompt_prepared";

interface SafeNineRouterFields {
  requestId?: string;
  traceId?: string;
  token?: string;
  callCount?: number;
  toolCount?: number;
  durationMs?: number;
  status?: number;
  instructionChars?: number;
  historyChars?: number;
  toolListChars?: number;
  promptChars?: number;
  contextParts?: number;
  category?: "auth" | "input" | "model" | "browser" | "broker" | "agent" | "timeout" | "cancelled";
}

export function newNineRouterRequestId(): string {
  return `r9_${randomUUID().replaceAll("-", "")}`;
}

export function logNineRouter(stage: NineRouterDiagnosticStage, fields: SafeNineRouterFields = {}): void {
  const evidence = {
    stage,
    ...(fields.requestId ? { request_id: fields.requestId } : {}),
    ...(fields.traceId ? { trace_id: fields.traceId } : {}),
    ...(fields.token ? { session_hash: createHash("sha256").update(fields.token).digest("hex").slice(0, 12) } : {}),
    ...(fields.callCount !== undefined ? { call_count: fields.callCount } : {}),
    ...(fields.toolCount !== undefined ? { tool_count: fields.toolCount } : {}),
    ...(fields.durationMs !== undefined ? { duration_ms: Math.max(0, Math.round(fields.durationMs)) } : {}),
    ...(fields.status !== undefined ? { status: fields.status } : {}),
    ...(fields.instructionChars !== undefined ? { instruction_chars: fields.instructionChars } : {}),
    ...(fields.historyChars !== undefined ? { history_chars: fields.historyChars } : {}),
    ...(fields.toolListChars !== undefined ? { tool_list_chars: fields.toolListChars } : {}),
    ...(fields.promptChars !== undefined ? { prompt_chars: fields.promptChars } : {}),
    ...(fields.contextParts !== undefined ? { context_parts: fields.contextParts } : {}),
    ...(fields.category ? { category: fields.category } : {}),
  };
  console.info(`[9router] ${JSON.stringify(evidence)}`);
}
