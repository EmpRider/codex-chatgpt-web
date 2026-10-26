import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
  ChatGptBrowserWorker, assertChatGptWebInputWithinLimits, assertChatGptWebMultipartInputWithinLimits,
  chatGptSuspensionClock, isChatGptBrowserViewportUnavailableError,
  remainingStageBudgetMs, resolveChatGptWebMultipartStagingMode, type BrowserTurn,
} from "../../adapters/chatgpt-web/browser-worker";
import { ChatGptExternalTurnProgress } from "../../adapters/chatgpt-web/turn-progress";
import { TurnBroker, type BrokerToolRequest, type BrokerTurnEnvironment } from "../../adapters/chatgpt-web/turn-broker";
import type { CodexProviderConfig } from "../../types";
import { CHATGPT_CONNECTOR_NAME } from "../../config";
import { MAX_CHATGPT_BROWSER_TABS } from "../../adapters/chatgpt-web/concurrency";
import { CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS } from "../../adapters/chatgpt-web/mcp-server";
import {
  compileChatGptWebPrompt, compileExternalAgentBiggerContextPrompt,
  type CompiledChatGptWebPrompt, type ExternalAgentChatGptPromptInput,
} from "../../adapters/chatgpt-web/prompt";
import { compiledChatGptWebMaxMessageChars, compiledChatGptWebMessages,
  estimateChatGptWebImageTokens, estimateCompiledChatGptWebInputTokens,
  estimateCompiledChatGptWebMessageTokens } from "../../adapters/chatgpt-web/input-tokens";
import { resolveChatGptWebModelMode } from "../../adapters/chatgpt-web/model";
import { ChatGptWebAdapterError } from "../../adapters/chatgpt-web/adapter-error";
import { CHATGPT_WEB_MODEL_ID, CHATGPT_WEB_LUNA_MODEL_ID } from "../../adapters/chatgpt-web/model";
import { resolveChatGptWebContextLimits, supportsChatGptWebBiggerContext } from "../../chatgpt-web-models";
import { estimateTokens } from "../../lib/token-estimate";
import type { AgentResponsesRequest, AgentResponsesToolOutput } from "./request";
import { AgentResponsesRequestError } from "./request";
import { reportAgentResponsesActivity, type ActivityDraft } from "../../activity-events";

/** Retain external-agent context-budget metadata without client branding. */
export class AgentResponsesContextLimitError extends AgentResponsesRequestError {
  readonly code = "context_length_exceeded";
  readonly type = "invalid_request_error";
  constructor(message: string, readonly contextWindow: number,
    readonly autoCompactTokenLimit: number, readonly estimatedInputTokens?: number) {
    super(`Prompt is too long. ${message}`, 400);
  }
}

/** Provider-owned diagnostics contain only fixed labels and bounded counts. */
function logAgentResponses(stage: string, fields: Record<string, unknown> = {}): void {
  const count = fields.callCount ?? fields.toolCount;
  const stages = {
    session_retired: { level: "INFO", category: "recovery", event: "session_retired", phase: "retirement", code: "ok" },
    browser_started: { level: "INFO", category: "browser", event: "browser_started", phase: "send", code: "ok" },
    prompt_prepared: { level: "DEBUG", category: "browser", event: "prompt_prepared", phase: "validation", code: "ok" },
    browser_viewport_retry: { level: "WARN", category: "recovery", event: "recovery_observed", phase: "recovery", code: "unavailable" },
    tool_results_returned: { level: "INFO", category: "mcp", event: "tool_results_returned", phase: "tools", code: "ok" },
    tool_batch_delivered: { level: "INFO", category: "mcp", event: "tool_batch_delivered", phase: "tools", code: "ok" },
    browser_finished: { level: "INFO", category: "browser", event: "browser_finished", phase: "completion", code: "ok" },
  } as const satisfies Record<string, ActivityDraft>;
  const draft = stages[stage as keyof typeof stages];
  if (!draft) return;
  reportAgentResponsesActivity({ ...draft, ...(stage === "session_retired" && fields.category === "timeout"
    ? { level: "WARN", code: "timeout" } as const
    : stage === "session_retired" && fields.category === "cancelled"
      ? { level: "WARN", code: "cancelled" } as const
      : stage === "session_retired" && fields.category === "unavailable"
        ? { level: "WARN", code: "unavailable" } as const : {}),
    ...(typeof count === "number" && Number.isSafeInteger(count)
    && count >= 0 && count <= 1_000_000 ? { count } : {}) }, {
    ...(typeof fields.requestId === "string" ? { requestId: fields.requestId } : {}),
    ...(typeof fields.traceId === "string" ? { turnId: fields.traceId } : {}),
  });
}

// Leave a margin before the existing MCP call deadline. The clock starts when
// a tool is returned to the coding agent, not while ChatGPT is still thinking.
const SESSION_TTL_MS = CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS - 10_000;
const MAX_ACTIVE_SESSIONS = MAX_CHATGPT_BROWSER_TABS;
// Each HTTP stage must eventually settle even if an out-of-process browser helper
// never resolves its promise or fails to observe cancellation. A tool-result wait
// happens between stages and has its own much shorter deadline.
export const AGENT_RESPONSES_MAX_STAGE_WAIT_MS = 30 * 60_000;
export const AGENT_RESPONSES_MAX_PENDING_TEXT_CHARS = 8_000_000;
// Browser's rich-text composer has mutated large external-agent JSON near 112K
// characters. Multipart transport is safer for long turns when opted in.
const EXTERNAL_AGENT_MULTIPART_THRESHOLD_CHARS = 100_000;
const EXTERNAL_AGENT_INLINE_MAX_CHARS = 180_000;
// Retrying a new page is safe only when the previous page never activated Send.
// A separate same-page recovery handles errors after ChatGPT accepted a submission.
export const MAX_AGENT_RESPONSES_PRE_SEND_VIEWPORT_RETRIES = 1;

export async function runAgentResponsesPreSendViewportRecovery(
  run: () => Promise<string>,
  isSubmissionStarted: () => boolean,
  signal: AbortSignal,
  onRetry: (attempt: number) => void = () => {},
): Promise<string> {
  for (let attempt = 0; ; attempt += 1) {
    try { return await run(); }
    catch (error) {
      if (signal.aborted || isSubmissionStarted()
        || !isChatGptBrowserViewportUnavailableError(error)
        || attempt >= MAX_AGENT_RESPONSES_PRE_SEND_VIEWPORT_RETRIES) throw error;
      onRetry(attempt + 1);
    }
  }
}

/** A broken broker transport must not pin a cancelled HTTP continuation forever.
 * The original operation still owns its late settlement, but its owner capability
 * has been revoked, so we never retry an ambiguous tool-result handoff.
 */
async function waitForAgentResponsesOwner<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  let detach = () => {};
  const stopped = new Promise<never>((_resolve, reject) => {
    const onAbort = () => reject(signal.reason instanceof Error
      ? signal.reason : new AgentResponsesRequestError("Agent Responses session was cancelled", 499));
    signal.addEventListener("abort", onAbort, { once: true });
    detach = () => signal.removeEventListener("abort", onAbort);
    if (signal.aborted) onAbort();
  });
  try { return await Promise.race([operation, stopped]); }
  finally { detach(); }
}

/** All checks run before opening a browser, avoiding a partially uploaded task. */
function verifyAgentResponsesMultipart(
  compiled: CompiledChatGptWebPrompt,
  model: { backendModel: string; adapterEffort: string; modelFamily?: "5.6" | "6" },
  capabilities: BrowserTurn["capabilities"],
): void {
  if (!compiled.multipart) throw new Error("Expected a multipart coding-agent prompt");
  const browserModel = model.backendModel;
  const selectedMode = resolveChatGptWebModelMode(browserModel, model.adapterEffort, capabilities);
  const messages = compiledChatGptWebMessages(compiled);
  const stages = messages.slice(0, -1);
  const maxStageMessageTokens = Math.max(...stages.map(text => estimateTokens(text, browserModel)));
  const maxStageChars = Math.max(...stages.map(text => text.length));
  const stagingMode = resolveChatGptWebMultipartStagingMode(
    browserModel, capabilities, maxStageMessageTokens, maxStageChars,
  );
  const finalMessage = messages.at(-1)!;
  assertChatGptWebMultipartInputWithinLimits(
    estimateCompiledChatGptWebInputTokens(compiled, browserModel),
    estimateCompiledChatGptWebMessageTokens(compiled, browserModel),
    browserModel, selectedMode.effort, capabilities,
    compiledChatGptWebMaxMessageChars(compiled), compiled.multipart.parts.length,
    { stagingEffort: stagingMode.effort, maxStageMessageTokens, maxStageChars,
      finalMessageTokens: estimateTokens(finalMessage, browserModel), finalMessageChars: finalMessage.length,
      finalImageTokens: estimateChatGptWebImageTokens(compiled) },
    model.modelFamily,
  );
}

type AgentResponsesModel = { backendModel: string; adapterEffort: string; modelFamily?: "5.6" | "6" };

/** Pure admission check. Call this before reserving durable idempotency intent.
 * The broker's real turn token has the same 37-character shape as this placeholder.
 */
const PREFLIGHT_TURN_TOKEN = `turn_${"x".repeat(32)}`;

function compileAgentResponsesRequest(
  request: AgentResponsesRequest,
  model: AgentResponsesModel,
  provider: CodexProviderConfig,
  tools: AgentResponsesRequest["tools"],
  token: string,
): CompiledChatGptWebPrompt {
  const images = request.history.flatMap(message => message.images ?? []);
  const input: ExternalAgentChatGptPromptInput = {
    agentKind: "external-agent",
    instructions: request.instructions,
    history: request.history.map(message => ({ role: message.role, text: message.text })),
    toolNames: tools.map(tool => tool.name),
    toolChoice: request.toolChoice,
    parallelToolCalls: request.parallelToolCalls,
    turnToken: token,
    connectorName: CHATGPT_CONNECTOR_NAME,
    images,
  };
  const capabilities: BrowserTurn["capabilities"] = {
    localToolsEnabled: tools.length > 0,
    solAvailable: provider.chatgptWeb?.solAvailable === true,
    extraHighAvailable: provider.chatgptWeb?.extraHighAvailable === true,
    proAvailable: provider.chatgptWeb?.proAvailable === true,
    experimentalBiggerContext: provider.chatgptWeb?.experimentalBiggerContext === true,
  };
  let compiled: CompiledChatGptWebPrompt;
  let initialEstimatedInputTokens: number | undefined;
  try {
    compiled = compileChatGptWebPrompt(input);
    initialEstimatedInputTokens = estimateCompiledChatGptWebInputTokens(compiled, model.backendModel);
    if (capabilities.experimentalBiggerContext) {
      const mode = resolveChatGptWebModelMode(model.backendModel, model.adapterEffort, capabilities);
      const regularLimit = resolveChatGptWebContextLimits(
        model.backendModel as typeof CHATGPT_WEB_MODEL_ID | typeof CHATGPT_WEB_LUNA_MODEL_ID, mode.effort,
        { ...capabilities, experimentalBiggerContext: false }, model.modelFamily).autoCompactTokenLimit;
      const shouldStage = compiled.text.length > EXTERNAL_AGENT_MULTIPART_THRESHOLD_CHARS
        || estimateCompiledChatGptWebInputTokens(compiled, model.backendModel) >= regularLimit;
      const canStage = supportsChatGptWebBiggerContext(model.backendModel, mode.effort, model.modelFamily);
      if (shouldStage && canStage) {
        for (const partCount of [2, 6] as const) {
          try {
            const candidate = compileExternalAgentBiggerContextPrompt(
              input, capabilities, model.backendModel as typeof CHATGPT_WEB_MODEL_ID | typeof CHATGPT_WEB_LUNA_MODEL_ID,
              mode.effort, partCount,
            );
            verifyAgentResponsesMultipart(candidate, model, capabilities);
            compiled = candidate;
            break;
          } catch (error) {
            if (!(error instanceof ChatGptWebAdapterError) || partCount === 6) throw error;
          }
        }
      }
    }
    if (!compiled.multipart && compiled.text.length > EXTERNAL_AGENT_INLINE_MAX_CHARS) {
      throw new ChatGptWebAdapterError(
        "Agent context exceeds the safe ChatGPT Web composer budget. Enable Bigger Context in the launcher and use a supported model, or run /compact in the coding agent before retrying.",
        { status: 413, errorType: "invalid_request_error", code: "context_length_exceeded", retryable: false },
      );
    }
    if (!compiled.multipart) {
      assertChatGptWebInputWithinLimits(
        initialEstimatedInputTokens,
        estimateCompiledChatGptWebMessageTokens(compiled, model.backendModel),
        model.backendModel, model.adapterEffort as Parameters<typeof assertChatGptWebInputWithinLimits>[3], capabilities,
        compiledChatGptWebMaxMessageChars(compiled), model.modelFamily,
      );
    }
    return compiled;
  } catch (error) {
    if (error instanceof ChatGptWebAdapterError && error.code === "context_length_exceeded") {
      const limits = resolveChatGptWebContextLimits(
        model.backendModel as typeof CHATGPT_WEB_MODEL_ID | typeof CHATGPT_WEB_LUNA_MODEL_ID,
        model.adapterEffort as Parameters<typeof assertChatGptWebInputWithinLimits>[3], capabilities, model.modelFamily,
      );
      const estimated = /estimated at ([\d,]+) input tokens/.exec(error.message)?.[1];
      throw new AgentResponsesContextLimitError(
        "Input exceeds the context budget for the selected model. Reduce the request size and retry.",
        limits.contextWindow, limits.autoCompactTokenLimit,
        estimated === undefined ? initialEstimatedInputTokens : Number(estimated.replaceAll(",", "")),
      );
    }
    if (error instanceof ChatGptWebAdapterError) {
      throw new AgentResponsesRequestError("Input is not supported by the selected model", 413);
    }
    throw error;
  }
}

function selectedAgentResponsesTools(request: AgentResponsesRequest): AgentResponsesRequest["tools"] {
  const chosenTool = typeof request.toolChoice === "object" ? request.toolChoice.name : undefined;
  return request.toolChoice === "none" ? []
    : chosenTool ? request.tools.filter(tool => tool.name === chosenTool)
    : request.tools;
}

export interface AgentResponsesStage {
  text: string;
  calls: BrokerToolRequest[];
  finished: boolean;
  /** Browser text already emitted to this stage's SSE observer; never replay it. */
  streamedText?: string;
}

interface AgentResponsesSession {
  traceId: string;
  requestId?: string;
  token: string;
  model: string;
  originalHistory: AgentResponsesRequest["history"];
  /** Caller-supplied earlier history is inert context, never broker evidence. */
  initialOutputs: AgentResponsesToolOutput[];
  /** Exact previous results confirmed by this same session's broker. */
  acceptedOutputs: AgentResponsesToolOutput[];
  tools: Set<string>;
  toolChoice: AgentResponsesRequest["toolChoice"];
  parallelToolCalls: boolean;
  choiceFulfilled: boolean;
  outstanding: Map<string, BrokerToolRequest>;
  pendingText: string;
  deliveredText: string;
  textObserver?: (text: string) => void;
  settled?: { text: string; error?: Error };
  browser: Promise<string>;
  progress: ChatGptExternalTurnProgress;
  abort: AbortController;
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  consuming: boolean;
  /** Reserved synchronously through broker ACK and the resumed browser stage. */
  handoffInProgress: boolean;
  waiters: Set<() => void>;
}

export interface AgentResponsesBrowserRunner {
  run(turn: BrowserTurn): Promise<string>;
}

export class AgentResponsesSessionManager {
  private readonly sessions = new Set<AgentResponsesSession>();
  private readonly pendingCalls = new Map<string, AgentResponsesSession>();
  private pendingRegistrations = 0;
  private cancellationGeneration = 0;
  private closed = false;
  constructor(
    private readonly broker: TurnBroker,
    private readonly provider: CodexProviderConfig,
    private readonly browser: AgentResponsesBrowserRunner = ChatGptBrowserWorker.forProvider(provider),
    private readonly toolResultTtlMs = SESSION_TTL_MS,
    private readonly stageWaitMs = AGENT_RESPONSES_MAX_STAGE_WAIT_MS,
  ) {
    if (!Number.isFinite(stageWaitMs) || stageWaitMs <= 0) {
      throw new Error("Agent Responses stage wait must be a positive finite timeout");
    }
  }

  private wake(session: AgentResponsesSession): void {
    for (const wake of session.waiters) wake();
    session.waiters.clear();
  }

  private close(session: AgentResponsesSession, reason?: Error): void {
    if (!this.sessions.delete(session)) return;
    const expectedCancellation = reason?.name === "AbortError"
      || reason?.message === "Generic Responses provider shut down"
      || reason?.message === "Generic Responses turns cancelled"
      || reason?.message === "Generic Responses turns cancelled by launcher"
      || reason?.message.includes("observer disconnected") === true;
    logAgentResponses("session_retired", { requestId: session.requestId, traceId: session.traceId,
      token: session.token, callCount: session.outstanding.size,
      category: reason?.message === "Agent Responses agent tool results expired" ? "timeout"
        : expectedCancellation ? "cancelled" : reason ? "unavailable" : undefined });
    clearTimeout(session.expiryTimer);
    for (const callId of session.outstanding.keys()) this.pendingCalls.delete(callId);
    session.abort.abort(reason ?? new Error("Agent Responses agent session retired"));
    void Promise.resolve(this.broker.revoke(session.token, reason)).catch((error: unknown) => {
      console.warn(`[agent-responses] broker_revoke_failed ${error instanceof Error ? error.name : "Error"}`);
    });
    session.progress.retire(reason ?? new Error("Agent Responses agent session retired"));
    this.wake(session);
  }

  closeAll(): void {
    this.closed = true;
    for (const session of [...this.sessions]) this.close(session, new Error("Generic Responses provider shut down"));
  }

  /** Cancel current browser and tool owners without disabling future requests. */
  cancelAll(reason: Error = new Error("Generic Responses turns cancelled")): number {
    // Also invalidate registrations still awaiting a broker response.
    this.cancellationGeneration++;
    const active = [...this.sessions];
    for (const session of active) this.close(session, reason);
    return active.length;
  }

  activeCount(): number { return this.sessions.size + this.pendingRegistrations; }
  hasPendingCall(callId: string): boolean { this.evictExpired(); return this.pendingCalls.has(callId); }

  /** No broker registration, journal claim or browser I/O is permitted before this passes. */
  preflight(request: AgentResponsesRequest, model: AgentResponsesModel): void {
    compileAgentResponsesRequest(request, model, this.provider, selectedAgentResponsesTools(request), PREFLIGHT_TURN_TOKEN);
  }

  private awaitAgentResults(session: AgentResponsesSession): void {
    clearTimeout(session.expiryTimer);
    session.expiresAt = Date.now() + this.toolResultTtlMs;
    session.expiryTimer = setTimeout(() => {
      if (session.outstanding.size > 0) this.close(session, new Error("Agent Responses agent tool results expired"));
    }, this.toolResultTtlMs);
    session.expiryTimer.unref?.();
  }

  private resumeBrowser(session: AgentResponsesSession): void {
    clearTimeout(session.expiryTimer);
    session.expiryTimer = undefined;
    // ChatGPT browser progress itself has separate native deadlines. Do not expire a live
    // model generation just because another agent started a second Agent Responses request.
    session.expiresAt = Number.POSITIVE_INFINITY;
  }

  private evictExpired(): void {
    for (const session of this.sessions) {
      if (session.outstanding.size > 0 && session.expiresAt < Date.now()) {
        this.close(session, new Error("Agent Responses agent tool results expired"));
      }
    }
  }

  async start(request: AgentResponsesRequest, model: AgentResponsesModel, observerSignal?: AbortSignal, requestId?: string, onTextDelta?: (delta: string) => void,
    onSendState?: (state: "send_activated" | "browser_accepted") => void): Promise<AgentResponsesStage> {
    if (this.closed) throw new AgentResponsesRequestError("Agent Responses provider is shutting down", 503);
    if (observerSignal?.aborted) throw new AgentResponsesRequestError("Provider request was cancelled", 499);
    this.evictExpired();
    if (this.sessions.size + this.pendingRegistrations >= MAX_ACTIVE_SESSIONS) {
      throw new AgentResponsesRequestError("Too many active Agent Responses tool sessions", 429);
    }
    const traceId = `agent_${randomUUID().replaceAll("-", "")}`;
    const tools = selectedAgentResponsesTools(request);
    this.preflight(request, model);
    const environment: BrokerTurnEnvironment = { kind: "external-agent", tools };
    // A bounded capability is sufficient; no local paths, native thread IDs or Codex sandbox claims.
    // An absolute broker TTL would silently shorten MCP invocations after a long-running
    // ChatGPT generation. The session itself owns and revokes this capability on settlement.
    // Claim capacity before the first await. Otherwise simultaneous registrations
    // all pass the size check and can oversubscribe the five browser slots.
    const generation = this.cancellationGeneration;
    this.pendingRegistrations += 1;
    let token: string;
    try { token = await this.broker.register(environment, undefined, traceId, true); }
    finally { this.pendingRegistrations -= 1; }
    if (this.closed || observerSignal?.aborted || generation !== this.cancellationGeneration) {
      try { await this.broker.revoke(token); }
      catch (error) { console.warn(`[agent-responses] late_owner_revoke_failed ${error instanceof Error ? error.name : "Error"}`); }
      throw new AgentResponsesRequestError(this.closed
        ? "Agent Responses provider shut down during broker registration" : "Provider request was cancelled",
      this.closed ? 503 : 499);
    }
    const session: AgentResponsesSession = {
      traceId, requestId,
      token, model: request.model, originalHistory: structuredClone(request.history),
      initialOutputs: structuredClone(request.outputs), acceptedOutputs: [],
      tools: new Set(tools.map(tool => tool.name)), toolChoice: request.toolChoice,
      parallelToolCalls: request.parallelToolCalls, choiceFulfilled: false,
      outstanding: new Map(), pendingText: "", deliveredText: "",
      progress: new ChatGptExternalTurnProgress(),
      browser: undefined as unknown as Promise<string>, abort: new AbortController(),
      expiresAt: Number.POSITIVE_INFINITY, consuming: false, handoffInProgress: false, waiters: new Set(),
    };
    this.sessions.add(session);
    logAgentResponses("browser_started", { requestId, traceId, token, toolCount: tools.length });

    // External context retains caller roles, advertised tools and tool results.
    const capabilities: BrowserTurn["capabilities"] = {
      localToolsEnabled: tools.length > 0,
      solAvailable: this.provider.chatgptWeb?.solAvailable === true,
      extraHighAvailable: this.provider.chatgptWeb?.extraHighAvailable === true,
      proAvailable: this.provider.chatgptWeb?.proAvailable === true,
      experimentalBiggerContext: this.provider.chatgptWeb?.experimentalBiggerContext === true,
    };
    let compiled: CompiledChatGptWebPrompt;
    try {
      compiled = compileAgentResponsesRequest(request, model, this.provider, tools, token);
    } catch (error) {
      this.close(session, error instanceof Error ? error : undefined);
      throw error;
    }
    // Register the observer before invoking the browser runner. The HTTP stream can be
    // cancelled while broker registration or prompt preparation is awaiting I/O;
    // addEventListener does not replay an AbortSignal that already fired.
    const onAbort = () => this.close(session, new Error("Agent Responses HTTP observer disconnected before tool delivery"));
    observerSignal?.addEventListener("abort", onAbort, { once: true });
    if (observerSignal?.aborted) {
      onAbort();
      observerSignal?.removeEventListener("abort", onAbort);
      throw new AgentResponsesRequestError("Provider request was cancelled", 499);
    }
    logAgentResponses("prompt_prepared", { requestId, traceId, token, instructionChars: request.instructions.length,
      historyChars: request.history.reduce((total, message) => total + message.text.length, 0),
      toolListChars: tools.reduce((total, tool) => total + tool.name.length, 0),
      promptChars: compiledChatGptWebMaxMessageChars(compiled),
      contextParts: compiled.multipart?.parts.length ?? 1 });
    let submissionStarted = false;
    const turn: BrowserTurn = {
      traceId, modelId: model.backendModel, reasoning: model.adapterEffort, modelFamily: model.modelFamily,
      capabilities,
      nativeConnector: tools.length > 0,
      prepare: async () => ({ ...compiled, release: () => {} }),
      abortSignal: session.abort.signal,
      onSendActivated: () => { submissionStarted = true; onSendState?.("send_activated"); },
      onSubmitted: () => { submissionStarted = true; onSendState?.("browser_accepted"); },
      onMultipartStageAcknowledged: () => { submissionStarted = true; onSendState?.("send_activated"); },
      onTextDelta: text => {
        if (session.deliveredText.length + session.pendingText.length + text.length > AGENT_RESPONSES_MAX_PENDING_TEXT_CHARS) {
          throw new AgentResponsesRequestError("Agent Responses browser response exceeds its safe in-memory output budget", 507);
        }
        session.pendingText += text;
        session.textObserver?.(text);
        this.wake(session);
      },
      externalProgress: session.progress,
      completionFence: {
        begin: async () => this.broker.beginCompletionFence(token),
        commit: async revision => this.broker.commitCompletionFence(token, revision),
      },
    };
    session.browser = runAgentResponsesPreSendViewportRecovery(
      () => this.browser.run(turn),
      () => submissionStarted || compiled.multipart !== undefined,
      session.abort.signal,
      attempt => logAgentResponses("browser_viewport_retry", { requestId, traceId, token, callCount: attempt }),
    ).then(text => {
      session.settled = { text }; this.wake(session); return text;
    }, error => {
      session.settled = { text: "", error: error instanceof Error ? error : new Error(String(error)) };
      this.wake(session); return "";
    });
    try { return await this.nextStage(session, onTextDelta); }
    catch (error) { this.close(session, error instanceof Error ? error : undefined); throw error; }
    finally { observerSignal?.removeEventListener("abort", onAbort); }
  }

  async continue(request: AgentResponsesRequest, observerSignal?: AbortSignal, requestId?: string, onTextDelta?: (delta: string) => void): Promise<AgentResponsesStage> {
    if (this.closed) throw new AgentResponsesRequestError("Agent Responses provider is shutting down", 503);
    if (observerSignal?.aborted) throw new AgentResponsesRequestError("Provider continuation was cancelled", 499);
    this.evictExpired();
    const matching = new Set<AgentResponsesSession>();
    for (const output of request.outputs) {
      const owner = this.pendingCalls.get(output.callId);
      if (owner) matching.add(owner);
    }
    if (matching.size !== 1) throw new AgentResponsesRequestError("No unambiguous active Agent Responses tool session matches these call IDs", 409);
    const session = [...matching][0]!;
    if (request.model !== session.model) throw new AgentResponsesRequestError("Model changed during a tool continuation", 409);
    // A call ID is only a capability within the authenticated provider account. Require the
    // original ordered conversation prefix as a second binding, without assuming private Agent Responses headers.
    if (request.history.length < session.originalHistory.length
      || session.originalHistory.some((message, i) => request.history[i]?.role !== message.role
        || request.history[i]?.text !== message.text
        || JSON.stringify(request.history[i]?.images ?? []) !== JSON.stringify(message.images ?? []))) {
      throw new AgentResponsesRequestError("Tool results do not belong to the original conversation history", 409);
    }
    // Check the COMPLETE current output set before the first broker handoff.
    // Initial client history is context only; later accepted results gain provenance
    // exclusively after this live session's whole batch was broker-ACKed.
    const prefix = [...session.initialOutputs, ...session.acceptedOutputs];
    if (request.outputs.length !== prefix.length + session.outstanding.size
      || prefix.some((accepted, index) => !isDeepStrictEqual(request.outputs[index], accepted))) {
      throw new AgentResponsesRequestError("Tool output history does not match this active session", 409);
    }
    const currentOutputs = request.outputs.slice(prefix.length);
    const outputsById = new Map(currentOutputs.map(output => [output.callId, output]));
    if (outputsById.size !== currentOutputs.length) throw new AgentResponsesRequestError("Duplicate function_call_output", 409);
    if ([...session.outstanding.keys()].some(id => !outputsById.has(id))) {
      throw new AgentResponsesRequestError("All outstanding tool results must be returned together", 409);
    }
    // An adapter may synthesize this placeholder for unmatched calls.
    // A placeholder is not evidence the originating agent executed the tool.
    if ([...session.outstanding.keys()].some(id => outputsById.get(id)?.output === "[No response received]")) {
      throw new AgentResponsesRequestError("Agent Responses synthesized a missing tool result; refusing to report fabricated execution", 409);
    }
    if (session.handoffInProgress || session.consuming) {
      throw new AgentResponsesRequestError("Concurrent continuation of a tool session is not supported", 409);
    }
    // All admission checks precede this non-awaiting claim. A losing observer
    // must never alter the winner's owner, request ID, or broker ACK state.
    session.handoffInProgress = true;
    try {
      if (requestId) session.requestId = requestId;
      const onAbort = () => this.close(session, new Error("Agent Responses continuation observer disconnected"));
      observerSignal?.addEventListener("abort", onAbort, { once: true });
      if (observerSignal?.aborted) {
        onAbort();
        observerSignal?.removeEventListener("abort", onAbort);
        throw new AgentResponsesRequestError("Provider continuation was cancelled", 499);
      }
      try {
        for (const call of session.outstanding.values()) {
          const output = outputsById.get(call.callId)!;
          // Tool execution stays at the originating coding agent; the MCP bridge gets only its returned data.
          await waitForAgentResponsesOwner(Promise.resolve(this.broker.completeTool(session.token, call.callId, output.result
            ? { ...output.result, ...(output.isError ? { isError: true } : {}) }
            : { content: [{ type: "text", text: output.output }], ...(output.isError ? { isError: true } : {}) })),
          session.abort.signal);
          session.progress.recordToolResult();
          this.pendingCalls.delete(call.callId);
        }
      } catch (error) {
        // A partial batch cannot be replayed safely. Some agent-side operations may have
        // already happened, so never silently start a second browser or replay those writes.
        this.close(session, error instanceof Error ? error : new Error("Tool result handoff failed"));
        observerSignal?.removeEventListener("abort", onAbort);
        throw new AgentResponsesRequestError("Tool result handoff failed; restart with a new task, do not replay mutations", 409);
      }
      const deliveredCount = session.outstanding.size;
      session.acceptedOutputs.push(...structuredClone(currentOutputs));
      session.outstanding.clear();
      logAgentResponses("tool_results_returned", { requestId, traceId: session.traceId,
        token: session.token, callCount: deliveredCount });
      this.resumeBrowser(session);
      try { return await this.nextStage(session, onTextDelta); }
      catch (error) { this.close(session, error instanceof Error ? error : undefined); throw error; }
      finally { observerSignal?.removeEventListener("abort", onAbort); }
    } finally {
      session.handoffInProgress = false;
    }
  }

  private async nextStage(session: AgentResponsesSession, onTextDelta?: (delta: string) => void): Promise<AgentResponsesStage> {
    if (session.consuming) throw new AgentResponsesRequestError("Agent session already has a pending HTTP observer", 409);
    session.consuming = true;
    let streamedText = "";
    const waiting = new AbortController();
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    let detachAbort = () => {};
    try {
      if (onTextDelta) {
        session.textObserver = text => { onTextDelta(text); streamedText += text; };
        // Text may have arrived while the agent was executing its preceding tool.
        if (session.pendingText) session.textObserver(session.pendingText);
      }
      const stopped = new Promise<never>((_resolve, reject) => {
        const signal = session.abort.signal;
        const onAbort = () => reject(signal.reason instanceof Error
          ? signal.reason : new AgentResponsesRequestError("Agent Responses browser session was cancelled", 499));
        signal.addEventListener("abort", onAbort, { once: true });
        detachAbort = () => signal.removeEventListener("abort", onAbort);
        if (signal.aborted) onAbort();
      });
      // Match the native Codex stage clock: time while the user's laptop was
      // suspended is not productive browser-processing time.
      chatGptSuspensionClock.start();
      const startedAt = performance.now();
      const suspendedAtStart = chatGptSuspensionClock.suspendedMs();
      const checkDeadline = () => {
        const remainingMs = remainingStageBudgetMs(
          this.stageWaitMs, performance.now() - startedAt,
          chatGptSuspensionClock.suspendedMs() - suspendedAtStart,
        );
        if (remainingMs > 0) {
          deadlineTimer = setTimeout(checkDeadline, remainingMs);
          deadlineTimer.unref?.();
          return;
        }
        this.close(session, new AgentResponsesRequestError(
          "Agent Responses browser stage exceeded its bounded execution deadline", 504));
      };
      deadlineTimer = setTimeout(checkDeadline, this.stageWaitMs);
      deadlineTimer.unref?.();
      const nextCalls = this.broker.nextToolBatch(session.token, waiting.signal).then(async calls => {
        if (calls.length > 0) {
          const revision = session.progress.recordToolBatch(calls.length);
          await session.progress.waitForToolBatchObservation(revision, waiting.signal);
          session.progress.assertToolBatchActive(revision);
        }
        return { type: "calls" as const, calls };
      });
      // The browser can settle without emitting any new text; wake when its final DOM result is known.
      const finished = session.browser.then(() => ({ type: "finished" as const }));
      const outcome = await Promise.race([nextCalls, finished, stopped]);
      waiting.abort();
      if (outcome.type === "calls" && outcome.calls.length > 0) {
        if (!session.parallelToolCalls && outcome.calls.length > 1) {
          throw new AgentResponsesRequestError("ChatGPT requested parallel tools but the caller disabled them", 422);
        }
        for (const call of outcome.calls) {
          if (call.freeform) throw new AgentResponsesRequestError("Agent Responses provider accepts only standard function calls", 422);
          if (!session.tools.has(call.wireName)) throw new AgentResponsesRequestError("Model requested a tool not advertised by the caller", 409);
          if (typeof session.toolChoice === "object" && call.wireName !== session.toolChoice.name) {
            throw new AgentResponsesRequestError("Model requested a different function than the caller's explicit tool_choice", 409);
          }
          if (this.pendingCalls.has(call.callId)) throw new Error("Duplicate live Agent Responses tool call ID");
          this.pendingCalls.set(call.callId, session);
          session.outstanding.set(call.callId, call);
        }
        session.choiceFulfilled = true;
        this.awaitAgentResults(session);
        logAgentResponses("tool_batch_delivered", { requestId: session.requestId, traceId: session.traceId,
          token: session.token, callCount: outcome.calls.length });
        const text = session.pendingText; session.pendingText = "";
        session.deliveredText += text;
        return { text, calls: outcome.calls, finished: false,
          ...(onTextDelta ? { streamedText } : {}) };
      }
      if (session.settled?.error) throw session.settled.error;
      if (!session.choiceFulfilled && (session.toolChoice === "required" || typeof session.toolChoice === "object")) {
        throw new AgentResponsesRequestError("ChatGPT Web finished without the tool call required by the coding agent", 422);
      }
      // The final DOM projection is authoritative. During a long generation the
      // last observed delta is often only a prefix; returning that prefix as the
      // entire answer silently truncated responses in the old Agent Responses path.
      const finalText = session.settled?.text;
      const text = finalText === undefined ? session.pendingText
        : finalText.startsWith(session.deliveredText)
          ? finalText.slice(session.deliveredText.length) : finalText;
      if (session.deliveredText.length + text.length > AGENT_RESPONSES_MAX_PENDING_TEXT_CHARS) {
        throw new AgentResponsesRequestError("Agent Responses browser response exceeds its safe in-memory output budget", 507);
      }
      if (session.pendingText && !text.startsWith(session.pendingText)) {
        throw new AgentResponsesRequestError("ChatGPT browser final text contradicts its observed incremental output", 502);
      }
      logAgentResponses("browser_finished", { requestId: session.requestId, traceId: session.traceId,
        token: session.token });
      this.close(session);
      return { text, calls: [], finished: true,
        ...(onTextDelta ? { streamedText } : {}) };
    } finally {
      session.textObserver = undefined;
      if (deadlineTimer) clearTimeout(deadlineTimer);
      detachAbort();
      waiting.abort();
      session.consuming = false;
    }
  }
}
