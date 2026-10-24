import { timingSafeEqual } from "node:crypto";
import { bridgeToResponsesSSE, buildResponseJSON } from "../../bridge";
import { AsyncEventQueue } from "../../event-queue";
import { readJsonRequestBody } from "../../http-body";
import { availableChatGptWebModelRoutes, requireChatGptWebModelRoute } from "../../chatgpt-web-models";
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

export const NINE_ROUTER_BASE_PATH = "/integrations/9router/v1";
export { NINE_ROUTER_KEY_ENV };

/** 9Router may retain a single provider prefix in the model alias (e.g. ccw/chatgpt-web/gpt-6-high). */
export function canonicalNineRouterModel(model: string): string {
  if (model.startsWith("chatgpt-web/")) return model;
  const match = /^[A-Za-z0-9][A-Za-z0-9_-]{0,63}\/(chatgpt-web\/[A-Za-z0-9._-]+)$/.exec(model);
  if (!match) throw new NineRouterRequestError("Expected a ChatGPT Web model ID (optionally prefixed once by 9Router)", 400);
  return match[1]!;
}

function errorResponse(status: number, message: string): Response {
  return Response.json({ error: { message, type: status === 401 ? "authentication_error" : "invalid_request_error", code: status } }, { status });
}

function bearerAuthorized(req: Request, key: string): boolean {
  const header = req.headers.get("authorization") ?? "";
  const expected = Buffer.from(`Bearer ${key}`);
  const actual = Buffer.from(header);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

function stageEvents(stage: NineRouterStage, request: NineRouterRequest): AdapterEvent[] {
  const events: AdapterEvent[] = [];
  if (stage.text) events.push({ type: "text_delta", text: stage.text });
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

  constructor(readonly config: AppConfig, broker: TurnBroker, key = loadNineRouterKey(), manager?: NineRouterSessionManager) {
    if (key !== undefined && key.length < 32) {
      throw new Error(`${NINE_ROUTER_KEY_ENV} must contain at least 32 characters`);
    }
    this.key = key || undefined;
    this.manager = manager ?? new NineRouterSessionManager(broker, providerConfig(config));
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
      return Response.json({ object: "list", data: availableChatGptWebModelRoutes(caps).map(route => ({
        id: route.slug, object: "model", created: 0, owned_by: "chatgpt-web",
      })) });
    }
    if (req.method !== "POST" || path !== `${NINE_ROUTER_BASE_PATH}/responses`) {
      return errorResponse(404, "Unknown 9Router provider route");
    }
    if (!/^application\/json(?:\s*;|$)/i.test(req.headers.get("content-type") ?? "")) {
      return errorResponse(415, "Responses provider requires application/json");
    }
    try {
      const request = parseNineRouterRequest(await readJsonRequestBody(req));
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
      logNineRouter("request_started", { requestId, toolCount: request.tools.length });
      const stagePromise = matchesPendingTool
        ? this.manager.continue(request, req.signal, requestId)
        : this.manager.start(request, route, req.signal, requestId);
      if (!request.stream) return Response.json(buildResponseJSON(stageEvents(await stagePromise, request), request.model));
      const queue = new AsyncEventQueue<AdapterEvent>();
      void stagePromise.then(stage => {
        for (const event of stageEvents(stage, request)) queue.push(event);
      }, error => {
        logNineRouter("request_failed", { requestId, status: error instanceof NineRouterRequestError ? error.status : 502,
          category: error instanceof NineRouterRequestError ? "agent" : "browser",
          durationMs: Date.now() - started });
        queue.push({ type: "error", message: error instanceof NineRouterRequestError
          ? error.message : "ChatGPT Web provider turn failed; see privacy-safe local logs" });
      }).finally(() => queue.close());
      return new Response(bridgeToResponsesSSE(queue, request.model), {
        headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache", "x-accel-buffering": "no" },
      });
    } catch (error) {
      const status = error instanceof NineRouterRequestError ? error.status : error instanceof SyntaxError ? 400 : 502;
      const message = error instanceof NineRouterRequestError ? error.message : "ChatGPT Web provider turn failed; see privacy-safe local logs";
      logNineRouter(status === 400 || status === 413 || status === 415 || status === 422 ? "parse_rejected" : "request_failed",
        { requestId, status, category: status === 400 || status === 413 || status === 415 || status === 422
          ? "input" : status === 409 ? "agent" : "browser", durationMs: Date.now() - started });
      return errorResponse(status, message);
    }
  }
}
