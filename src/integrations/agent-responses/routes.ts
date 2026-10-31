import { createHash, randomUUID, timingSafeEqual } from "node:crypto";
import { bridgeToResponsesSSE, buildResponseJSON } from "../../bridge";
import { AsyncEventQueue } from "../../event-queue";
import { HttpBodyReadError, readJsonRequestBody } from "../../http-body";
import { availableChatGptWebModelRoutes, chatGptWebRouteEfforts, requireChatGptWebModelRoute,
  resolveChatGptWebContextLimits, CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET,
  CHATGPT_WEB_PLATFORM_RESERVE_TOKENS, CHATGPT_WEB_LUNA_BACKEND_MODEL } from "../../chatgpt-web-models";
import { providerConfig, type AppConfig } from "../../config";
import type { AdapterEvent } from "../../types";
import { TurnBroker } from "../../adapters/chatgpt-web/turn-broker";
import { parseAgentResponsesRequest, AgentResponsesRequestError,
  type AgentResponsesRequest } from "./request";
import { AgentResponsesSessionManager, AgentResponsesContextLimitError,
  type AgentResponsesStage } from "./session-manager";
import { AgentResponsesSessionManagerWithExtendedLease } from "./session-manager-wrapper";
import { loadAgentResponsesKey } from "./key-manager";
import { AgentResponsesAttemptJournal } from "./attempt-journal";
import { estimateAgentResponsesUsage } from "./usage";
import { reportAgentResponsesActivity, type ActivityDraft } from "../../activity-events";

export const AGENT_RESPONSES_BASE_PATH = "/v1";
export const AGENT_RESPONSES_BODY_UPLOAD_TIMEOUT_MS = 60_000;

function publicError(status: number, message: string, error?: unknown): Response {
  const limits = error instanceof AgentResponsesContextLimitError ? {
    context_window: error.contextWindow,
    auto_compact_token_limit: error.autoCompactTokenLimit,
    ...(error.estimatedInputTokens === undefined ? {} : { estimated_input_tokens: error.estimatedInputTokens }),
  } : {};
  return Response.json({ error: { message,
    type: status === 401 ? "authentication_error" : status >= 500 ? "server_error" : "invalid_request_error",
    code: error instanceof AgentResponsesContextLimitError ? error.code : status, ...limits,
  } }, { status });
}

function authorized(request: Request, key: string): boolean {
  // Fixed-length SHA-256 buffers avoid timingSafeEqual's unequal-length early return.
  const expected = createHash("sha256").update(`Bearer ${key}`).digest();
  const supplied = createHash("sha256").update(request.headers.get("authorization") ?? "").digest();
  return timingSafeEqual(expected, supplied);
}

function trustedLoopbackRequest(request: Request): boolean {
  const url = new URL(request.url);
  // Origin cannot be an authorization signal: browser pages and DNS-rebound pages are untrusted.
  if (request.headers.has("origin") || url.hostname !== "127.0.0.1") return false;
  const host = request.headers.get("host");
  return !host || host === url.host;
}

function stageEvents(stage: AgentResponsesStage, request: AgentResponsesRequest): AdapterEvent[] {
  if (stage.streamedText !== undefined && !stage.text.startsWith(stage.streamedText)) {
    throw new AgentResponsesRequestError("Final browser output disagreed with the streamed prefix", 502);
  }
  const events: AdapterEvent[] = [];
  const pending = stage.streamedText === undefined ? stage.text : stage.text.slice(stage.streamedText.length);
  if (pending) events.push({ type: "text_delta", text: pending });
  for (const call of stage.calls) {
    if (call.freeform) throw new AgentResponsesRequestError("Only declared standard functions are supported", 422);
    events.push({ type: "tool_call_start", id: call.callId, name: call.wireName });
    events.push({ type: "tool_call_delta", arguments: JSON.stringify(call.arguments ?? {}) });
    events.push({ type: "tool_call_end" });
  }
  events.push({ type: "done", endTurn: stage.finished, usage: estimateAgentResponsesUsage(request, stage) });
  return events;
}

function statusOf(error: unknown): number {
  if (error instanceof AgentResponsesRequestError || error instanceof HttpBodyReadError) {
    // Client disconnect is not an OpenAI request-validation error.
    return error.status === 499 ? 503 : error.status;
  }
  const status = (error as { status?: unknown } | null)?.status;
  // Browser sign-in/permission failures are gateway failures, never invalid API credentials.
  // Do not trust arbitrary upstream 4xx statuses as client-side OpenAI errors.
  return status === 504 ? 504 : status === 503 ? 503 : 502;
}

function safeMessage(error: unknown, status: number): string {
  // The bounded shared reader still has a retired-provider diagnostic. Never expose it here.
  if (error instanceof HttpBodyReadError && status === 429) return "Too many concurrent generic Responses body uploads";
  if ((error instanceof AgentResponsesRequestError || error instanceof HttpBodyReadError) && status < 500) {
    return error.message;
  }
  if (status === 409) return "This attempt is already in progress or cannot safely be replayed";
  if (status === 503) return "Generic Responses service is unavailable";
  if (status === 504) return "Generic Responses stage timed out";
  if (status === 429) return "Generic Responses service capacity exceeded";
  return "Generic Responses request failed";
}

function safeStageMessage(error: unknown, status: number): string {
  // Parsing and request validation have public messages; browser/tool execution does not.
  if (error instanceof AgentResponsesContextLimitError) return safeMessage(error, status);
  if (status === 503) return "Generic Responses service is unavailable";
  if (status === 504) return "Generic Responses stage timed out";
  if (status === 429) return "Generic Responses service capacity exceeded";
  return "Generic Responses request failed";
}

/** Untrusted API principal is distinct from native Codex. No native dispatch/fallback. */
export class AgentResponsesProvider {
  private readonly manager: AgentResponsesSessionManager;
  private readonly key: string | undefined;
  private readonly journal: AgentResponsesAttemptJournal;

  constructor(readonly config: AppConfig, broker: TurnBroker, key = loadAgentResponsesKey(),
    manager?: AgentResponsesSessionManager, journal?: AgentResponsesAttemptJournal) {
    if (key !== undefined && key.length < 43) throw new Error("Generic Responses bearer must be at least 256 bits");
    this.key = key || undefined;
    this.manager = manager ?? new AgentResponsesSessionManagerWithExtendedLease(broker, providerConfig(config));
    this.journal = journal ?? new AgentResponsesAttemptJournal();
  }

  get enabled(): boolean {
    return this.key !== undefined && this.config.mode === "full"
      && this.config.browserInteractionMode === "automatic";
  }
  get activeCount(): number { return this.manager.activeCount(); }
  cancelActiveTurns(): number { return this.manager.cancelAll(new Error("Generic Responses turns cancelled by launcher")); }
  close(): void { this.manager.closeAll(); }

  async handle(request: Request, path: string, draining: boolean | (() => boolean) = false): Promise<Response> {
    const isDraining = () => typeof draining === "function" ? draining() : draining;
    const requestId = randomUUID();
    const started = Date.now();
    const log = (draft: ActivityDraft): void => reportAgentResponsesActivity(draft, { requestId });
    const done = (response: Response): Response => {
      log({ level: response.ok ? "INFO" : "WARN", category: "api",
        event: response.ok ? "request_completed" : "request_rejected", phase: "completion",
        code: response.ok ? "ok" : response.status === 401 ? "unauthorized" : "invalid_request",
        ...(response.status === 200 || response.status === 400 || response.status === 401
          || response.status === 403 || response.status === 404 || response.status === 409
          || response.status === 415 || response.status === 422 || response.status === 429
          || response.status === 503 ? { http_status: response.status } : {}),
        duration_ms: Math.min(86_400_000, Date.now() - started) });
      return response;
    };
    log({ level: "INFO", category: "api", event: "request_started", phase: "admission", code: "ok" });
    if (!this.enabled) return done(publicError(404, "Generic Responses service is disabled"));
    if (!trustedLoopbackRequest(request)) return done(publicError(403, "Non-loopback or browser-origin request rejected"));
    if (!authorized(request, this.key!)) {
      log({ level: "WARN", category: "api", event: "auth_rejected", phase: "auth", code: "unauthorized" });
      return done(publicError(401, "Invalid API bearer"));
    }
    const caps = {
      solAvailable: this.config.solAvailable,
      extraHighAvailable: this.config.extraHighAvailable,
      proAvailable: this.config.proAvailable,
      browserInteractionMode: this.config.browserInteractionMode,
      experimentalBiggerContext: this.config.experimentalBiggerContext,
    };
    if (request.method === "GET" && path === "/v1/models") {
      if (isDraining()) return done(publicError(503, "Generic Responses service is draining"));
      return done(Response.json({ object: "list", data: availableChatGptWebModelRoutes(caps).map(route => {
        const limits = resolveChatGptWebContextLimits(route.backendModel, route.adapterEffort, caps,
          route.interactionMode === "automatic" ? route.modelFamily : undefined);
        const singleMessageLuna = route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL
          && !caps.experimentalBiggerContext;
        const window = singleMessageLuna ? CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET : limits.contextWindow;
        const compact = singleMessageLuna
          ? window - CHATGPT_WEB_PLATFORM_RESERVE_TOKENS : limits.autoCompactTokenLimit;
        return { id: route.slug, object: "model", created: 0, owned_by: "agent-responses",
          context_length: window, context_window: window, auto_compact_token_limit: compact };
      }) }));
    }
    if (request.method !== "POST" || path !== "/v1/responses") {
      return done(publicError(404, "Unknown generic Responses route"));
    }
    if (!/^application\/json(?:\s*;|$)/i.test(request.headers.get("content-type") ?? "")) {
      return done(publicError(415, "Responses payload requires application/json"));
    }
    let attempt: ReturnType<AgentResponsesAttemptJournal["claim"]>;
    let stageStarted = false;
    try {
      let rawBody: unknown;
      try { rawBody = await readJsonRequestBody(request, { readTimeoutMs: AGENT_RESPONSES_BODY_UPLOAD_TIMEOUT_MS }); }
      catch (error) {
        if (error instanceof SyntaxError) throw new AgentResponsesRequestError("Malformed JSON request body", 400);
        throw error;
      }
      const parsed = parseAgentResponsesRequest(rawBody);
      const matchesPending = parsed.outputs.some(output => this.manager.hasPendingCall(output.callId));
      if (matchesPending && parsed.newUserAfterToolHistory) {
        throw new AgentResponsesRequestError("A new user turn cannot preempt an outstanding tool", 409);
      }
      if (parsed.outputs.length && !matchesPending && !parsed.newUserAfterToolHistory) {
        throw new AgentResponsesRequestError("Tool continuation has no matching live owner", 409);
      }
      if (isDraining() && !matchesPending) return done(publicError(503, "Generic Responses service is draining"));
      let route: ReturnType<typeof requireChatGptWebModelRoute>;
      try { route = requireChatGptWebModelRoute(parsed.model, caps); }
      catch { throw new AgentResponsesRequestError("Unknown or unavailable model", 400); }
      if (parsed.reasoningEffort !== undefined) {
        const available = chatGptWebRouteEfforts(route, caps);
        if (!available.includes(parsed.reasoningEffort)) {
          throw new AgentResponsesRequestError(
            `Reasoning effort ${JSON.stringify(parsed.reasoningEffort)} is unavailable for ${JSON.stringify(parsed.model)}; available: ${available.join(", ")}`,
            422,
          );
        }
        route = requireChatGptWebModelRoute(parsed.model, caps, parsed.reasoningEffort);
      }
      if (route.interactionMode !== "automatic") {
        throw new AgentResponsesRequestError("Manual browser mode is unsupported", 422);
      }
      if (!matchesPending) this.manager.preflight(parsed, route);
      attempt = this.journal.claim(request.headers.get("idempotency-key"), rawBody);
      if (attempt) log({ level: "DEBUG", category: "journal", event: "journal_claimed", phase: "journal", code: "ok" });
      if (matchesPending) attempt?.advance("tool_handoff_possible");
      const observer = new AbortController();
      const signal = parsed.stream ? AbortSignal.any([request.signal, observer.signal]) : request.signal;
      const queue = parsed.stream ? new AsyncEventQueue<AdapterEvent>() : undefined;
      const onDelta = queue ? (delta: string) => queue.push({ type: "text_delta", text: delta }) : undefined;
      const stage = matchesPending
        ? this.manager.continue(parsed, signal, requestId, onDelta)
        : this.manager.start(parsed, route, signal, requestId, onDelta, state => {
          attempt?.advance(state);
          log({ level: "INFO", category: "browser", event: state === "send_activated" ? "send_activated" : "send_accepted",
            phase: state === "send_activated" ? "send" : "accepted", code: "ok" });
        });
      stageStarted = true;
      log({ level: "INFO", category: matchesPending ? "mcp" : "browser",
        event: matchesPending ? "tool_results_received" : "browser_started",
        phase: matchesPending ? "tools" : "send", code: "ok" });
      let published = false;
      const final = (completed: AgentResponsesStage): AdapterEvent[] => {
        const events = stageEvents(completed, parsed);
        attempt?.advance(completed.finished ? "response_prepared" : "tools_pending");
        published = true;
        log({ level: "INFO", category: "browser", event: "browser_finished", phase: "completion", code: "ok",
          duration_ms: Math.min(86_400_000, Date.now() - started) });
        if (parsed.stream) log({ level: "INFO", category: "api", event: "request_completed", phase: "completion",
          code: "ok", http_status: 200, duration_ms: Math.min(86_400_000, Date.now() - started) });
        return events;
      };
      if (!parsed.stream) return done(Response.json(buildResponseJSON(final(await stage), parsed.model)));
      if (!queue) throw new Error("Streaming queue was not initialized");
      // The shared SSE bridge watches adapter events (not wire-level keep-alives).
      // A healthy, long browser stage must not look like a stalled adapter.
      const stageHeartbeat = setInterval(() => {
        if (!signal.aborted) {
          try { queue.push({ type: "heartbeat" }); }
          catch { clearInterval(stageHeartbeat); observer.abort(new Error("Generic Responses stream buffer exceeded")); }
        }
      }, 10_000);
      stageHeartbeat.unref?.();
      void stage.then(completed => {
        if (signal.aborted) return;
        for (const event of final(completed)) queue.push(event);
      }).catch(error => {
        if (signal.aborted) return;
        try { attempt?.advance("outcome_unknown"); }
        catch { /* The durable claim still prevents a keyed retry. */ }
        log({ level: "ERROR", category: "api", event: "request_failed", phase: "completion", code: "internal",
          duration_ms: Math.min(86_400_000, Date.now() - started) });
        try { queue.push({ type: "error", message: safeStageMessage(error, statusOf(error)), status: statusOf(error) }); }
        catch { /* Detached queue cannot crash the process. */ }
      }).finally(() => { clearInterval(stageHeartbeat); queue.close(); });
      return new Response(bridgeToResponsesSSE(queue, parsed.model, undefined, undefined, undefined, () => {
        clearInterval(stageHeartbeat);
        queue.close();
        if (!published) {
          try { attempt?.advance("outcome_unknown"); }
          catch { /* Key claim remains blocking. */ }
          log({ level: "WARN", category: "api", event: "request_failed", phase: "completion",
            code: "cancelled", duration_ms: Math.min(86_400_000, Date.now() - started) });
        }
        observer.abort(new Error("Generic Responses observer disconnected"));
      }), { headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache" } });
    } catch (error) {
      const status = statusOf(error);
      log({ level: status >= 500 ? "ERROR" : "WARN", category: "api", event: "request_failed", phase: "completion",
        code: status >= 500 ? "internal" : "invalid_request",
        duration_ms: Math.min(86_400_000, Date.now() - started) });
      return done(publicError(status, stageStarted ? safeStageMessage(error, status) : safeMessage(error, status), error));
    }
  }
}
