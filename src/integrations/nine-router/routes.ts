import { timingSafeEqual } from "node:crypto";
import { bridgeToResponsesSSE, buildResponseJSON } from "../../bridge";
import { AsyncEventQueue } from "../../event-queue";
import { HttpBodyReadError, readJsonRequestBody } from "../../http-body";
import { availableChatGptWebModelRoutes, requireChatGptWebModelRoute, resolveChatGptWebContextLimits,
  CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET, CHATGPT_WEB_PLATFORM_RESERVE_TOKENS,
  CHATGPT_WEB_LUNA_BACKEND_MODEL } from "../../chatgpt-web-models";
import type { AppConfig } from "../../config";
import { providerConfig } from "../../config";
import { TurnBroker } from "../../adapters/chatgpt-web/turn-broker";
import type { AdapterEvent } from "../../types";
import { NineRouterRequestError, parseNineRouterRequest } from "./request";
import { NineRouterSessionManager, type NineRouterStage } from "./session-manager";
import { loadNineRouterKey, NINE_ROUTER_KEY_ENV } from "./key-manager";
import { logNineRouter, newNineRouterRequestId } from "./diagnostics";
import { estimateNineRouterUsage } from "./usage";
import type { NineRouterRequest } from "./request";
import { NineRouterAttemptJournal } from "./attempt-journal";
import { NineRouterContextLimitError } from "./errors";

export const NINE_ROUTER_BASE_PATH = "/integrations/9router/v1";
export { NINE_ROUTER_KEY_ENV };
export const NINE_ROUTER_STAGE_HEARTBEAT_MS = 10_000;
export const NINE_ROUTER_BODY_UPLOAD_TIMEOUT_MS = 60_000;

/** Native Codex emits adapter heartbeats during thinking, not just wire-level SSE pings.
 * Renew the bridge's upstream watchdog while an owned browser stage is still pending.
 * The stage promise controls the lifetime; this never fabricates response content.
 */
export function keepNineRouterStageAlive(
  queue: AsyncEventQueue<AdapterEvent>,
  stage: Promise<unknown>,
  intervalMs = NINE_ROUTER_STAGE_HEARTBEAT_MS,
): () => void {
  // The queue is intentionally bounded. If its consumer disconnects or stops
  // reading, don't leave an interval writing into a dead stream indefinitely.
  let stopped = false;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
  };
  const timer = setInterval(() => {
    if (stopped) return;
    try { queue.push({ type: "heartbeat" }); }
    catch { stop(); } // Detached/non-consuming streams must not crash the daemon.
  }, intervalMs);
  timer.unref?.();
  void stage.then(stop, stop);
  return stop;
}

/** 9Router may retain a single provider prefix in the model alias (e.g. ccw/chatgpt-web/gpt-6-high). */
export function canonicalNineRouterModel(model: string): string {
  if (model.startsWith("chatgpt-web/")) return model;
  const match = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/(chatgpt-web\/[A-Za-z0-9._-]+)$/.exec(model);
  if (!match) throw new NineRouterRequestError("Expected a ChatGPT Web model ID (optionally prefixed once by 9Router)", 400);
  return match[1]!;
}

function errorResponse(status: number, message: string, error?: unknown): Response {
  const context = error instanceof NineRouterContextLimitError ? {
    context_window: error.contextWindow,
    auto_compact_token_limit: error.autoCompactTokenLimit,
    ...(error.estimatedInputTokens !== undefined ? { estimated_input_tokens: error.estimatedInputTokens } : {}),
  } : {};
  return Response.json({ error: { message,
    type: status === 401 ? "authentication_error" : status >= 500 ? "server_error" : "invalid_request_error",
    code: error instanceof NineRouterContextLimitError ? error.code : status,
    ...context } }, { status });
}

function bearerAuthorized(req: Request, key: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${key}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function stageEvents(stage: NineRouterStage, request: NineRouterRequest): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  // In a streaming request, the browser's incremental text has already reached
  // the SSE bridge. Validate the prefix before appending any final remainder:
  // a changed final projection must fail rather than silently duplicate text.
  if (stage.streamedText !== undefined && !stage.text.startsWith(stage.streamedText)) {
    throw new NineRouterRequestError("ChatGPT browser final text diverged from streamed output", 502);
  }
  const pendingText = stage.streamedText === undefined ? stage.text : stage.text.slice(stage.streamedText.length);
  if (pendingText) events.push({ type: "text_delta", text: pendingText });
  for (const call of stage.calls) {
    if (call.freeform) throw new NineRouterRequestError("9Router provider accepts only standard function calls", 422);
    events.push({ type: "tool_call_start", id: call.callId, name: call.wireName });
    events.push({ type: "tool_call_delta", arguments: JSON.stringify(call.arguments ?? {}) });
    events.push({ type: "tool_call_end" });
  }
  events.push({ type: "done", endTurn: stage.finished, usage: estimateNineRouterUsage(request, stage) });
  return events;
}

/** Optional sidecar endpoint: no changes to upstream /v1/responses or its native Codex identity checks. */
export class NineRouterProvider {
  private readonly manager: NineRouterSessionManager;
  private readonly key: string | undefined;
  private readonly journal: NineRouterAttemptJournal;

  constructor(readonly config: AppConfig, broker: TurnBroker, key = loadNineRouterKey(), manager?: NineRouterSessionManager,
    journal?: NineRouterAttemptJournal) {
    if (key !== undefined && key.length < 32) {
      throw new Error(`${NINE_ROUTER_KEY_ENV} must contain at least 32 characters`);
    }
    this.key = key || undefined;
    this.manager = manager ?? new NineRouterSessionManager(broker, providerConfig(config));
    this.journal = journal ?? new NineRouterAttemptJournal();
  }

  get enabled(): boolean { return this.key !== undefined && this.config.mode === "full" && this.config.browserInteractionMode === "automatic"; }
  get activeCount(): number { return this.manager.activeCount(); }
  close(): void { this.manager.closeAll(); }

  async handle(req: Request, path: string, draining = false): Promise<Response> {
    const requestId = newNineRouterRequestId();
    const started = Date.now();
    if (!this.enabled) return errorResponse(404, "9Router integration is disabled (requires Automatic Full mode and its API key)");
    if (!bearerAuthorized(req, this.key!)) {
      logNineRouter("auth_rejected", { requestId, status: 401, category: "auth" });
      return errorResponse(401, "Invalid provider API key");
    }
    const caps = {
      solAvailable: this.config.solAvailable,
      extraHighAvailable: this.config.extraHighAvailable,
      proAvailable: this.config.proAvailable,
      browserInteractionMode: this.config.browserInteractionMode,
      experimentalBiggerContext: this.config.experimentalBiggerContext,
    };
    if (req.method === "GET" && path === `${NINE_ROUTER_BASE_PATH}/models`) {
      if (draining) return errorResponse(503, "Service is draining");
      return Response.json({ object: "list", data: availableChatGptWebModelRoutes(caps).map(route => {
        const limits = resolveChatGptWebContextLimits(
          route.backendModel, route.adapterEffort, caps, route.interactionMode === "automatic" ? route.modelFamily : undefined,
        );
        // Native Codex's Luna checkpoints support long *cumulative* histories,
        // but external 9Router requests are whole-history uploads. Do not advertise
        // the native 1M rolling window as if a single browser message could hold it.
        const singleMessageLuna = route.backendModel === CHATGPT_WEB_LUNA_BACKEND_MODEL && !caps.experimentalBiggerContext;
        const window = singleMessageLuna ? CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET : limits.contextWindow;
        const compact = singleMessageLuna
          ? CHATGPT_LUNA_BROWSER_INPUT_TOKEN_BUDGET - CHATGPT_WEB_PLATFORM_RESERVE_TOKENS
          : limits.autoCompactTokenLimit;
        return { id: route.slug, object: "model", created: 0, owned_by: "chatgpt-web",
          context_length: window, context_window: window, auto_compact_token_limit: compact };
      }) });
    }
    if (req.method !== "POST" || path !== `${NINE_ROUTER_BASE_PATH}/responses`) {
      return errorResponse(404, "Unknown 9Router provider route");
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
      return errorResponse(415, "Responses provider requires application/json");
    }
    try {
      const rawBody = await readJsonRequestBody(req, { readTimeoutMs: NINE_ROUTER_BODY_UPLOAD_TIMEOUT_MS });
      const request = parseNineRouterRequest(rawBody);
      const matchesPendingTool = request.outputs.some(output => this.manager.hasPendingCall(output.callId));
      if (matchesPendingTool && request.newUserAfterToolHistory) {
        throw new NineRouterRequestError("A new user turn cannot preempt an outstanding agent tool call", 409);
      }
      // 9Router replays full conversation history. Old function_call_output records in a later
      // user turn must not be mistaken for unresolved tool calls from the previous completed turn.
      if (request.outputs.length > 0 && !matchesPendingTool && !request.newUserAfterToolHistory) {
        throw new NineRouterRequestError("Tool continuation is expired or missing its live browser session", 409);
      }
      // Drain disallows new owners but must still accept authentic results from already running
      // coding agents, otherwise an in-flight MCP invocation could never finish.
      if (draining && !matchesPendingTool) return errorResponse(503, "Service is draining");
      const canonicalModel = canonicalNineRouterModel(request.model);
      let route: ReturnType<typeof requireChatGptWebModelRoute>;
      try { route = requireChatGptWebModelRoute(canonicalModel, caps); }
      catch { throw new NineRouterRequestError("ChatGPT Web model is unknown or unavailable", 400); }
      if (route.interactionMode !== "automatic") throw new NineRouterRequestError("Manual browser mode is unsupported", 422);
      // This is a deterministic, side-effect-free admission check. A rejected oversized
      // context must not consume a durable idempotency key or open an SSE stream.
      if (!matchesPendingTool) this.manager.preflight(request, route);
      // Reserve the caller's identity on disk before any potentially accepted Send or tool
      // result handoff. Even if the daemon crashes before Send, retry must fail closed.
      const attempt = this.journal.claim(req.headers.get("idempotency-key"), rawBody);
      if (matchesPendingTool) attempt?.advance("tool_handoff_possible");
      logNineRouter("request_started", { requestId, toolCount: request.tools.length });
      const streamObserver = new AbortController();
      const observerSignal = request.stream ? AbortSignal.any([req.signal, streamObserver.signal]) : req.signal;
      const queue = request.stream ? new AsyncEventQueue<AdapterEvent>() : undefined;
      const onTextDelta = queue ? (delta: string) => queue.push({ type: "text_delta", text: delta }) : undefined;
      const stagePromise = matchesPendingTool
        ? this.manager.continue(request, observerSignal, requestId, onTextDelta)
        : this.manager.start(request, route, observerSignal, requestId, onTextDelta,
          state => attempt?.advance(state));
      let stagePublished = false;
      const prepareStage = (stage: NineRouterStage) => {
        const events = stageEvents(stage, request);
        attempt?.advance(stage.finished ? "response_prepared" : "tools_pending");
        stagePublished = true;
        return events;
      };
      if (!request.stream) return Response.json(buildResponseJSON(prepareStage(await stagePromise), request.model));
      if (!queue) throw new Error("Streaming queue was not initialized");
      const stopHeartbeat = keepNineRouterStageAlive(queue, stagePromise);
      void stagePromise.then(stage => {
        if (observerSignal.aborted) return;
        for (const event of prepareStage(stage)) queue.push(event);
      }).catch(error => {
        if (observerSignal.aborted) return; // Expected disconnect; browser owner was already retired.
        try { attempt?.advance("outcome_unknown"); }
        catch { /* Intent was already committed; the retry remains blocked. */ }
        logNineRouter("request_failed", { requestId, status: error instanceof NineRouterRequestError ? error.status : 502,
          category: error instanceof NineRouterRequestError ? "agent" : "browser",
          durationMs: Date.now() - started });
        try {
          queue.push({ type: "error", message: error instanceof NineRouterRequestError
            ? error.message : "ChatGPT Web provider turn failed; see privacy-safe local logs" });
        } catch { /* A detached or full output queue cannot make the provider crash. */ }
      }).finally(() => { stopHeartbeat(); queue.close(); });
      return new Response(bridgeToResponsesSSE(queue, request.model, undefined, undefined, undefined,
        () => {
          stopHeartbeat();
          queue.close();
          if (!stagePublished) {
            try { attempt?.advance("outcome_unknown"); }
            catch { /* Already committed intent still blocks unsafe duplicate execution. */ }
          }
          streamObserver.abort(new Error("9Router streaming observer disconnected"));
        }), {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" },
      });
    } catch (error) {
      const status = error instanceof NineRouterRequestError || error instanceof HttpBodyReadError
        ? error.status : error instanceof SyntaxError ? 400 : 502;
      const message = error instanceof NineRouterRequestError || error instanceof HttpBodyReadError
        ? error.message : "ChatGPT Web provider turn failed; see privacy-safe local logs";
      logNineRouter(status === 400 || status === 413 || status === 415 || status === 422 || status === 429 ? "parse_rejected" : "request_failed",
        { requestId, status, category: status === 400 || status === 413 || status === 415 || status === 422 || status === 429
          ? "input" : status === 409 ? "agent" : "browser", durationMs: Date.now() - started });
      return errorResponse(status, message, error);
    }
  }
}
