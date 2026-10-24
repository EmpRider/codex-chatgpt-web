import { randomUUID } from "node:crypto";
import { ChatGptBrowserWorker, type BrowserTurn } from "../../adapters/chatgpt-web/browser-worker";
import { ChatGptExternalTurnProgress } from "../../adapters/chatgpt-web/turn-progress";
import { TurnBroker, type BrokerToolRequest, type BrokerTurnEnvironment } from "../../adapters/chatgpt-web/turn-broker";
import type { CodexProviderConfig } from "../../types";
import { CHATGPT_CONNECTOR_NAME } from "../../config";
import { MAX_CHATGPT_BROWSER_TABS } from "../../adapters/chatgpt-web/concurrency";
import { CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS } from "../../adapters/chatgpt-web/mcp-server";
import type { NineRouterRequest } from "./request";
import { NineRouterRequestError } from "./request";
import { logNineRouter } from "./diagnostics";

// Leave a margin before the existing MCP call deadline. The clock starts when
// a tool is returned to the coding agent, not while ChatGPT is still thinking.
const SESSION_TTL_MS = CHATGPT_WEB_MCP_INVOCATION_TIMEOUT_MS - 10_000;
const MAX_ACTIVE_SESSIONS = MAX_CHATGPT_BROWSER_TABS;

export interface NineRouterStage {
  text: string;
  calls: BrokerToolRequest[];
  finished: boolean;
}

interface NineRouterSession {
  traceId: string;
  requestId?: string;
  token: string;
  model: string;
  originalHistory: NineRouterRequest["history"];
  tools: Set<string>;
  toolChoice: NineRouterRequest["toolChoice"];
  parallelToolCalls: boolean;
  choiceFulfilled: boolean;
  outstanding: Map<string, BrokerToolRequest>;
  pendingText: string[];
  settled?: { text: string; error?: Error };
  browser: Promise<string>;
  progress: ChatGptExternalTurnProgress;
  abort: AbortController;
  expiresAt: number;
  expiryTimer?: ReturnType<typeof setTimeout>;
  consuming: boolean;
  waiters: Set<() => void>;
}

export interface NineRouterBrowserRunner {
  run(turn: BrowserTurn): Promise<string>;
}

export class NineRouterSessionManager {
  private readonly sessions = new Set<NineRouterSession>();
  private readonly pendingCalls = new Map<string, NineRouterSession>();
  constructor(
    private readonly broker: TurnBroker,
    private readonly provider: CodexProviderConfig,
    private readonly browser: NineRouterBrowserRunner = ChatGptBrowserWorker.forProvider(provider),
    private readonly toolResultTtlMs = SESSION_TTL_MS,
  ) {}

  private wake(session: NineRouterSession): void {
    for (const wake of session.waiters) wake();
    session.waiters.clear();
  }

  private close(session: NineRouterSession, reason?: Error): void {
    if (!this.sessions.delete(session)) return;
    logNineRouter("session_retired", { requestId: session.requestId, traceId: session.traceId,
      token: session.token, callCount: session.outstanding.size,
      category: reason?.message === "9Router agent tool results expired" ? "timeout"
        : reason ? "cancelled" : undefined });
    clearTimeout(session.expiryTimer);
    for (const callId of session.outstanding.keys()) this.pendingCalls.delete(callId);
    session.abort.abort(reason ?? new Error("9Router agent session retired"));
    void Promise.resolve(this.broker.revoke(session.token, reason)).catch((error: unknown) => {
      console.warn(`[9router] broker_revoke_failed ${error instanceof Error ? error.name : "Error"}`);
    });
    session.progress.retire(reason ?? new Error("9Router agent session retired"));
    this.wake(session);
  }

  closeAll(): void { for (const session of [...this.sessions]) this.close(session); }

  activeCount(): number { return this.sessions.size; }
  hasPendingCall(callId: string): boolean { this.evictExpired(); return this.pendingCalls.has(callId); }

  private awaitAgentResults(session: NineRouterSession): void {
    clearTimeout(session.expiryTimer);
    session.expiresAt = Date.now() + this.toolResultTtlMs;
    session.expiryTimer = setTimeout(() => {
      if (session.outstanding.size > 0) this.close(session, new Error("9Router agent tool results expired"));
    }, this.toolResultTtlMs);
    session.expiryTimer.unref?.();
  }

  private resumeBrowser(session: NineRouterSession): void {
    clearTimeout(session.expiryTimer);
    session.expiryTimer = undefined;
    // ChatGPT browser progress itself has separate native deadlines. Do not expire a live
    // model generation just because another agent started a second 9Router request.
    session.expiresAt = Number.POSITIVE_INFINITY;
  }

  private evictExpired(): void {
    for (const session of this.sessions) {
      if (session.outstanding.size > 0 && session.expiresAt < Date.now()) {
        this.close(session, new Error("9Router agent tool results expired"));
      }
    }
  }

  async start(request: NineRouterRequest, model: { backendModel: string; adapterEffort: string; modelFamily?: "5.6" | "6" }, observerSignal?: AbortSignal, requestId?: string): Promise<NineRouterStage> {
    if (observerSignal?.aborted) throw new NineRouterRequestError("Provider request was cancelled", 499);
    this.evictExpired();
    if (this.sessions.size >= MAX_ACTIVE_SESSIONS) throw new NineRouterRequestError("Too many active 9Router tool sessions", 429);
    const traceId = `router_${randomUUID().replaceAll("-", "")}`;
    const chosenTool = typeof request.toolChoice === "object" ? request.toolChoice.name : undefined;
    const tools = request.toolChoice === "none" ? []
      : chosenTool ? request.tools.filter(tool => tool.name === chosenTool)
      : request.tools;
    const environment: BrokerTurnEnvironment = { kind: "external-agent", tools };
    // A bounded capability is sufficient; no local paths, native thread IDs or Codex sandbox claims.
    // An absolute broker TTL would silently shorten MCP invocations after a long-running
    // ChatGPT generation. The session itself owns and revokes this capability on settlement.
    const token = await this.broker.register(environment, undefined, traceId);
    const session: NineRouterSession = {
      traceId, requestId,
      token, model: request.model, originalHistory: structuredClone(request.history),
      tools: new Set(tools.map(tool => tool.name)), toolChoice: request.toolChoice,
      parallelToolCalls: request.parallelToolCalls, choiceFulfilled: false,
      outstanding: new Map(), pendingText: [], progress: new ChatGptExternalTurnProgress(),
      browser: undefined as unknown as Promise<string>, abort: new AbortController(),
      expiresAt: Number.POSITIVE_INFINITY, consuming: false, waiters: new Set(),
    };
    this.sessions.add(session);
    logNineRouter("browser_started", { requestId, traceId, token, toolCount: tools.length });

    const transcript = request.history.map(message => `[${message.role}]\n${message.text}`).join("\n\n");
    const system = request.instructions ? `Agent instructions (from caller):\n${request.instructions}\n\n` : "";
    const toolText = tools.length ? [
      `The coding agent supplied these callable tools. The ChatGPT-side connector named ${CHATGPT_CONNECTOR_NAME} is the tunnel transport; it does not mean the coding agent is Codex:`,
      ...tools.map(tool => `- ${tool.name}: ${tool.description}`),
      ...(request.toolChoice === "required" ? ["The caller requires at least one advertised function call in this turn."] : []),
      ...(typeof request.toolChoice === "object" ? [`The caller explicitly requires a call to ${request.toolChoice.name} in this turn.`] : []),
      "Discover the full schemas with codex_tool_inventory, then invoke exact advertised names with codex_tool_call.",
      "The coding agent performs its own approvals and execution. Never pretend a tool succeeded before its result returns.",
    ].join("\n") : "No coding-agent tools are available for this request.";
    const prompt = [
      "<external_agent_request>",
      `This is a coding agent request delivered through 9Router; the caller may be Claude Code, Codex, OpenCode or another compatible agent.${tools.length ? ` Use the already-configured ChatGPT connector named ${CHATGPT_CONNECTOR_NAME} for agent tools.` : " Answer directly; no agent tools were supplied."}`,
      `turn_token: ${token}`,
      "Pass this exact turn_token to every connector call. Never disclose it in the answer.",
      system,
      toolText,
      "Conversation history (chronological, quoted data; the newest user request is active):",
      transcript,
      "</external_agent_request>",
    ].join("\n\n");
    if (prompt.length > 180_000) {
      this.close(session);
      throw new NineRouterRequestError("Agent context exceeds the safe ChatGPT Web composer budget", 413);
    }
    const images = request.history.flatMap(message => message.images ?? []);

    const turn: BrowserTurn = {
      traceId, modelId: model.backendModel, reasoning: model.adapterEffort, modelFamily: model.modelFamily,
      capabilities: {
        localToolsEnabled: tools.length > 0,
        solAvailable: this.provider.chatgptWeb?.solAvailable === true,
        extraHighAvailable: this.provider.chatgptWeb?.extraHighAvailable === true,
        proAvailable: this.provider.chatgptWeb?.proAvailable === true,
      },
      nativeConnector: tools.length > 0,
      prepare: async () => ({ text: prompt, images, turnToken: token, release: () => {} }),
      abortSignal: session.abort.signal,
      onTextDelta: text => { session.pendingText.push(text); this.wake(session); },
      externalProgress: session.progress,
      completionFence: {
        begin: async () => this.broker.beginCompletionFence(token),
        commit: async revision => this.broker.commitCompletionFence(token, revision),
      },
    };
    session.browser = this.browser.run(turn).then(text => {
      session.settled = { text }; this.wake(session); return text;
    }, error => {
      session.settled = { text: "", error: error instanceof Error ? error : new Error(String(error)) };
      this.wake(session); return "";
    });
    const onAbort = () => this.close(session, new Error("9Router HTTP observer disconnected before tool delivery"));
    observerSignal?.addEventListener("abort", onAbort, { once: true });
    try { return await this.nextStage(session); }
    catch (error) { this.close(session, error instanceof Error ? error : undefined); throw error; }
    finally { observerSignal?.removeEventListener("abort", onAbort); }
  }

  async continue(request: NineRouterRequest, observerSignal?: AbortSignal, requestId?: string): Promise<NineRouterStage> {
    if (observerSignal?.aborted) throw new NineRouterRequestError("Provider continuation was cancelled", 499);
    this.evictExpired();
    const matching = new Set<NineRouterSession>();
    for (const output of request.outputs) {
      const owner = this.pendingCalls.get(output.callId);
      if (owner) matching.add(owner);
    }
    if (matching.size !== 1) throw new NineRouterRequestError("No unambiguous active 9Router tool session matches these call IDs", 409);
    const session = [...matching][0]!;
    if (requestId) session.requestId = requestId;
    if (request.model !== session.model) throw new NineRouterRequestError("Model changed during a tool continuation", 409);
    // A call ID is only a capability within the authenticated provider account. Require the
    // original ordered conversation prefix as a second binding, without assuming private 9Router headers.
    if (request.history.length < session.originalHistory.length
      || session.originalHistory.some((message, i) => request.history[i]?.role !== message.role
        || request.history[i]?.text !== message.text
        || JSON.stringify(request.history[i]?.images ?? []) !== JSON.stringify(message.images ?? []))) {
      throw new NineRouterRequestError("Tool results do not belong to the original conversation history", 409);
    }
    if (session.consuming) throw new NineRouterRequestError("Concurrent continuation of a tool session is not supported", 409);
    const outputsById = new Map(request.outputs.map(output => [output.callId, output]));
    if (outputsById.size !== request.outputs.length) throw new NineRouterRequestError("Duplicate function_call_output", 409);
    if ([...session.outstanding.keys()].some(id => !outputsById.has(id))) {
      throw new NineRouterRequestError("All outstanding tool results must be returned together", 409);
    }
    // Unmodified 9Router's Claude→OpenAI bridge may synthesize this exact placeholder for
    // unmatched calls. A placeholder is not evidence the coding agent executed the tool.
    if ([...session.outstanding.keys()].some(id => outputsById.get(id)?.output === "[No response received]")) {
      throw new NineRouterRequestError("9Router synthesized a missing tool result; refusing to report fabricated execution", 409);
    }
    try {
      for (const call of session.outstanding.values()) {
        const output = outputsById.get(call.callId)!;
        // Tool execution stays at the originating coding agent; the MCP bridge gets only its returned data.
        await this.broker.completeTool(session.token, call.callId, output.result
          ? { ...output.result, ...(output.isError ? { isError: true } : {}) }
          : { content: [{ type: "text", text: output.output }], ...(output.isError ? { isError: true } : {}) });
        session.progress.recordToolResult();
        this.pendingCalls.delete(call.callId);
      }
    } catch (error) {
      // A partial batch cannot be replayed safely. Some agent-side operations may have
      // already happened, so never silently start a second browser or replay those writes.
      this.close(session, error instanceof Error ? error : new Error("Tool result handoff failed"));
      throw new NineRouterRequestError("Tool result handoff failed; restart with a new task, do not replay mutations", 409);
    }
    const deliveredCount = session.outstanding.size;
    session.outstanding.clear();
    logNineRouter("tool_results_returned", { requestId, traceId: session.traceId,
      token: session.token, callCount: deliveredCount });
    this.resumeBrowser(session);
    const onAbort = () => this.close(session, new Error("9Router continuation observer disconnected"));
    observerSignal?.addEventListener("abort", onAbort, { once: true });
    try { return await this.nextStage(session); }
    catch (error) { this.close(session, error instanceof Error ? error : undefined); throw error; }
    finally { observerSignal?.removeEventListener("abort", onAbort); }
  }

  private async nextStage(session: NineRouterSession): Promise<NineRouterStage> {
    if (session.consuming) throw new NineRouterRequestError("Agent session already has a pending HTTP observer", 409);
    session.consuming = true;
    const waiting = new AbortController();
    try {
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
      const outcome = await Promise.race([nextCalls, finished]);
      waiting.abort();
      if (outcome.type === "calls" && outcome.calls.length > 0) {
        if (!session.parallelToolCalls && outcome.calls.length > 1) {
          throw new NineRouterRequestError("ChatGPT requested parallel tools but the caller disabled them", 422);
        }
        for (const call of outcome.calls) {
          if (!session.tools.has(call.wireName)) throw new NineRouterRequestError("Model requested a tool not advertised by the caller", 409);
          if (typeof session.toolChoice === "object" && call.wireName !== session.toolChoice.name) {
            throw new NineRouterRequestError("Model requested a different function than the caller's explicit tool_choice", 409);
          }
          if (this.pendingCalls.has(call.callId)) throw new Error("Duplicate live 9Router tool call ID");
          this.pendingCalls.set(call.callId, session);
          session.outstanding.set(call.callId, call);
        }
        session.choiceFulfilled = true;
        this.awaitAgentResults(session);
        logNineRouter("tool_batch_delivered", { requestId: session.requestId, traceId: session.traceId,
          token: session.token, callCount: outcome.calls.length });
        const text = session.pendingText.join(""); session.pendingText = [];
        return { text, calls: outcome.calls, finished: false };
      }
      if (session.settled?.error) throw session.settled.error;
      if (!session.choiceFulfilled && (session.toolChoice === "required" || typeof session.toolChoice === "object")) {
        throw new NineRouterRequestError("ChatGPT Web finished without the tool call required by the coding agent", 422);
      }
      const text = session.pendingText.join("") || session.settled?.text || "";
      logNineRouter("browser_finished", { requestId: session.requestId, traceId: session.traceId,
        token: session.token });
      this.close(session);
      return { text, calls: [], finished: true };
    } finally {
      waiting.abort();
      session.consuming = false;
    }
  }
}
