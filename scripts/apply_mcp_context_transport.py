from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def replace_once(path: str, old: str, new: str) -> None:
    target = ROOT / path
    text = target.read_text(encoding="utf-8")
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f"{path}: expected exactly one match, found {count}\n--- needle ---\n{old}")
    target.write_text(text.replace(old, new, 1), encoding="utf-8")


# prompt.ts: imports and compiled-prompt shape.
replace_once(
    "src/adapters/chatgpt-web/prompt.ts",
    '''import { ChatGptWebAdapterError } from "./adapter-error";
import { estimateTokens } from "../../lib/token-estimate";''',
    '''import { ChatGptWebAdapterError } from "./adapter-error";
import {
  CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS,
  CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
  chatGptWebMcpContextChunks,
  createChatGptWebMcpContextTransport,
  type ChatGptWebMcpContextTransport,
} from "./context-transport";
import { estimateTokens } from "../../lib/token-estimate";''',
)

replace_once(
    "src/adapters/chatgpt-web/prompt.ts",
    '''export interface CompiledChatGptWebPrompt {
  text: string;
  images: ChatGptWebPromptImage[];
  /** DEV-only transactional context transport. Production prompts remain inline. */
  multipart?: ChatGptWebMultipartPrompt;''',
    '''export interface CompiledChatGptWebPrompt {
  text: string;
  images: ChatGptWebPromptImage[];
  /** Exact canonical context held locally when a large Full-mode turn uses MCP context transport. */
  contextTransport?: ChatGptWebMcpContextTransport;
  /** DEV-only transactional context transport. Production prompts remain inline unless MCP-backed. */
  multipart?: ChatGptWebMultipartPrompt;''',
)

replace_once(
    "src/adapters/chatgpt-web/prompt.ts",
    '''    const answerContract = captureLunaCheckpoint
      ? "Return the complete answer that the outer Codex task should receive, then the required private checkpoint tail."
      : "Return only the answer that the outer Codex task should receive.";
    if (multipartEnabled) {''',
    '''    const answerContract = captureLunaCheckpoint
      ? "Return the complete answer that the outer Codex task should receive, then the required private checkpoint tail."
      : "Return only the answer that the outer Codex task should receive.";
    const envelopeJson = withoutRetiredTurnHandles(JSON.stringify({ version: 3, system, messages }));
    const useMcpContextTransport = mode.localTools
      && !manualControl
      && !parsed._compactionRequest
      && envelopeJson.length >= CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS;
    if (useMcpContextTransport) {
      const contextTransport = createChatGptWebMcpContextTransport(envelopeJson);
      const totalChunks = chatGptWebMcpContextChunks(contextTransport).length;
      const mcpSharedContract = sharedContract.map(line => line
        .replace("The staged JSON task context", "The MCP-delivered JSON task context")
        .replace("The inline JSON task context", "The MCP-delivered JSON task context")
        .replace("Read and reconstruct every acknowledged staged JSON record before acting.", "Read and reconstruct every MCP context chunk before acting.")
        .replace("Read the complete inline JSON task context before acting.", "Read the complete MCP-delivered JSON task context before acting.")
        .replace("Each image_attachment in the staged context", "Each image_attachment in the MCP-delivered context")
        .replace("Each image_attachment in the context", "Each image_attachment in the MCP-delivered context"));
      const mcpContextContract = [
        "<codex_mcp_context_manifest>",
        `context_id: ${contextTransport.contextId}`,
        `context_sha256: ${contextTransport.sha256}`,
        `context_chars: ${contextTransport.chars}`,
        `context_bytes: ${contextTransport.bytes}`,
        `context_chunks: ${totalChunks}`,
        `chunk_chars_max: ${contextTransport.chunkChars}`,
        `Use turn_token ${turnToken} unchanged for every Codex Native call in this response.`,
        `The canonical Codex task context is local and is not rendered in this ChatGPT message. Load every context chunk before executing the task or calling any other work tool.`,
        `First call codex_tool_inventory with the turn_token above and query ${JSON.stringify(CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME)}.`,
        `Then call codex_tool_call with the same turn_token, wire_name ${JSON.stringify(CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME)}, and arguments ${JSON.stringify({ context_id: contextTransport.contextId, chunk: 0 })}.`,
        "For every result, append its text field in chunk order. If next_chunk is a number, call the same wire_name again with that chunk. Continue until next_chunk is null.",
        `Require every result to report context_id ${contextTransport.contextId} and sha256 ${contextTransport.sha256}. If the reader is missing, any chunk fails, metadata conflicts, or the sequence is incomplete, stop and report the transport failure instead of executing from partial context.`,
        "After all chunks are loaded, parse their concatenation as the single canonical Codex context JSON envelope and apply the role semantics above.",
        "</codex_mcp_context_manifest>",
      ];
      const text = [
        ...mcpSharedContract,
        ...transportContract,
        ...outputControlContract,
        ...checkpointContract,
        answerContract,
        ...mcpContextContract,
        "<codex_transport_resume>",
        "The task context is complete only after the MCP context reader has returned every chunk. Execute the latest active user request only after that point.",
        "</codex_transport_resume>",
      ].join("\\n");
      return { text, images, contextTransport };
    }
    if (multipartEnabled) {''',
)

replace_once(
    "src/adapters/chatgpt-web/prompt.ts",
    '''    const envelopeJson = withoutRetiredTurnHandles(JSON.stringify({ version: 3, system, messages }));
    const text = [
      ...sharedContract,''',
    '''    const text = [
      ...sharedContract,''',
)

# turn-broker.ts: store immutable context alongside the turn and expose owner/read wire operations.
replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''import {
  CompactionTransactionStore,
  type CompactionTransactionHandle,
} from "./compaction-transaction";
import type { ChatGptTurnEnvironment } from "./environment";''',
    '''import {
  CompactionTransactionStore,
  type CompactionTransactionHandle,
} from "./compaction-transaction";
import {
  assertChatGptWebMcpContextTransport,
  chatGptWebMcpContextChunk,
  chatGptWebMcpContextManifest,
  type ChatGptWebMcpContextTransport,
} from "./context-transport";
import type { ChatGptTurnEnvironment } from "./environment";''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''interface TurnChannel {
  traceId: string;
  externalOwner: boolean;
  environment: PendingTurn;
  bindingId?: string;''',
    '''interface TurnChannel {
  traceId: string;
  externalOwner: boolean;
  environment: PendingTurn;
  contextTransport?: ChatGptWebMcpContextTransport;
  bindingId?: string;''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''    | "invoke"
    | "owner_status"
    | "owner_register"
    | "owner_register_safe"
    | "owner_update"''',
    '''    | "invoke"
    | "context_read"
    | "owner_status"
    | "owner_register"
    | "owner_register_safe"
    | "owner_update"
    | "owner_set_context"''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''  environment?: ChatGptTurnEnvironment;
  ttlMs?: number;
  traceId?: string;''',
    '''  environment?: ChatGptTurnEnvironment;
  contextTransport?: ChatGptWebMcpContextTransport | null;
  contextId?: string;
  chunk?: number;
  ttlMs?: number;
  traceId?: string;''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''  updateEnvironment(token: string, environment: ChatGptTurnEnvironment): void | Promise<void>;
  confirmSafeTurnSent(''',
    '''  updateEnvironment(token: string, environment: ChatGptTurnEnvironment): void | Promise<void>;
  setContextTransport?(token: string, context?: ChatGptWebMcpContextTransport): void | Promise<void>;
  confirmSafeTurnSent(''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''  async nextToolBatch(token: string, signal?: AbortSignal): Promise<BrokerToolRequest[]> {''',
    '''  async setContextTransport(token: string, context?: ChatGptWebMcpContextTransport): Promise<void> {
    this.prune();
    const channel = this.channels.get(token);
    if (!channel) throw new Error("turn token is invalid or expired");
    if (channel.bindingId) throw new Error("Codex MCP context transport cannot change after the turn is already bound");
    if (context === undefined) {
      delete channel.contextTransport;
      return;
    }
    channel.contextTransport = assertChatGptWebMcpContextTransport(context);
  }

  async nextToolBatch(token: string, signal?: AbortSignal): Promise<BrokerToolRequest[]> {''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''    if (!["claim", "resolve", "release", "invoke", "owner_status", "owner_register", "owner_register_safe", "owner_update", "owner_safe_sent", "owner_next", "owner_complete", "owner_completion_fence_begin", "owner_completion_fence_commit", "owner_wait_retirement", "owner_revoke", "owner_safe_wait_start", "owner_safe_wait_completion", "owner_request_compaction", "owner_compaction_delivery_count", "safe_start", "safe_complete", "activity_complete", "submit_compaction_handoff"].includes(request.method)) {''',
    '''    if (!["claim", "resolve", "release", "invoke", "context_read", "owner_status", "owner_register", "owner_register_safe", "owner_update", "owner_set_context", "owner_safe_sent", "owner_next", "owner_complete", "owner_completion_fence_begin", "owner_completion_fence_commit", "owner_wait_retirement", "owner_revoke", "owner_safe_wait_start", "owner_safe_wait_completion", "owner_request_compaction", "owner_compaction_delivery_count", "safe_start", "safe_complete", "activity_complete", "submit_compaction_handoff"].includes(request.method)) {''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''    if (request.method === "owner_status") {
      return { protocolVersion: 5, acceptingExternalOwners: this.acceptingExternalOwners };
    }''',
    '''    if (request.method === "owner_status") {
      return { protocolVersion: 6, acceptingExternalOwners: this.acceptingExternalOwners };
    }''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''    if (request.method === "owner_update") {
      if (!request.token) throw new Error("turn owner token is required");
      this.updateEnvironment(request.token, ownerEnvironment(request.environment));
      return { updated: true };
    }
    if (request.method === "owner_safe_sent") {''',
    '''    if (request.method === "owner_update") {
      if (!request.token) throw new Error("turn owner token is required");
      this.updateEnvironment(request.token, ownerEnvironment(request.environment));
      return { updated: true };
    }
    if (request.method === "owner_set_context") {
      if (!request.token) throw new Error("turn owner token is required");
      const context = request.contextTransport;
      if (context !== null && context !== undefined && (typeof context !== "object" || Array.isArray(context))) {
        throw new Error("turn owner context transport is invalid");
      }
      await this.setContextTransport(request.token, context ?? undefined);
      return { updated: true };
    }
    if (request.method === "owner_safe_sent") {''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''        return { bindingId: activeChannel.bindingId, activityId, environment: activeChannel.environment };
      }
      this.pending.delete(token);
      const bindingId = opaqueId("binding");
      activeChannel.bindingId = bindingId;
      this.bindings.set(bindingId, { token, channel: activeChannel });
      return { bindingId, activityId, environment: activeChannel.environment };''',
    '''        return {
          bindingId: activeChannel.bindingId,
          activityId,
          environment: activeChannel.environment,
          ...(activeChannel.contextTransport
            ? { contextTransport: chatGptWebMcpContextManifest(activeChannel.contextTransport) }
            : {}),
        };
      }
      this.pending.delete(token);
      const bindingId = opaqueId("binding");
      activeChannel.bindingId = bindingId;
      this.bindings.set(bindingId, { token, channel: activeChannel });
      return {
        bindingId,
        activityId,
        environment: activeChannel.environment,
        ...(activeChannel.contextTransport
          ? { contextTransport: chatGptWebMcpContextManifest(activeChannel.contextTransport) }
          : {}),
      };''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''    if (request.method === "release") {
      this.revoke(binding.token);
      return { released: true };
    }
    if (request.method === "resolve") return { environment: binding.channel.environment };
    this.assertSafeHarnessRunning(binding.channel);''',
    '''    if (request.method === "release") {
      this.revoke(binding.token);
      return { released: true };
    }
    if (request.method === "resolve") return { environment: binding.channel.environment };
    if (request.method === "context_read") {
      this.assertSafeHarnessRunning(binding.channel);
      const context = binding.channel.contextTransport;
      if (!context) throw new Error("Codex MCP context is unavailable for this turn");
      if (typeof request.contextId !== "string" || request.contextId.length === 0) {
        throw new Error("Codex MCP context id is required");
      }
      if (!Number.isSafeInteger(request.chunk) || request.chunk! < 0) {
        throw new Error("Codex MCP context chunk is invalid");
      }
      return chatGptWebMcpContextChunk(context, request.contextId, request.chunk!);
    }
    this.assertSafeHarnessRunning(binding.channel);''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''    if (status.protocolVersion !== 5) {
      throw new Error(`Unsupported DEV turn-owner protocol version: ${String(status.protocolVersion)}`);
    }''',
    '''    if (status.protocolVersion !== 6) {
      throw new Error(`Unsupported DEV turn-owner protocol version: ${String(status.protocolVersion)}`);
    }''',
)

replace_once(
    "src/adapters/chatgpt-web/turn-broker.ts",
    '''  async updateEnvironment(token: string, environment: ChatGptTurnEnvironment): Promise<void> {
    await callTurnBroker(this.socketPath, { method: "owner_update", token, environment });
  }

  async confirmSafeTurnSent(''',
    '''  async updateEnvironment(token: string, environment: ChatGptTurnEnvironment): Promise<void> {
    await callTurnBroker(this.socketPath, { method: "owner_update", token, environment });
  }

  async setContextTransport(token: string, context?: ChatGptWebMcpContextTransport): Promise<void> {
    await callTurnBroker(this.socketPath, {
      method: "owner_set_context",
      token,
      contextTransport: context ?? null,
    }, null);
  }

  async confirmSafeTurnSent(''',
)

# mcp-server.ts: reuse existing public inventory/call ABI for the bridge-owned reader.
replace_once(
    "src/adapters/chatgpt-web/mcp-server.ts",
    '''import type { ChatGptTurnEnvironment } from "./environment";
import { CODEX_COMPACTION_CONTROL_WIRE_NAME } from "./native-compaction-control";''',
    '''import type { ChatGptTurnEnvironment } from "./environment";
import {
  CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
  type ChatGptWebMcpContextManifest,
} from "./context-transport";
import { CODEX_COMPACTION_CONTROL_WIRE_NAME } from "./native-compaction-control";''',
)

replace_once(
    "src/adapters/chatgpt-web/mcp-server.ts",
    '''interface ClaimedTurn {
  bindingId: string;
  activityId: string;
  environment: ChatGptTurnEnvironment & { expiresAt?: number };
}''',
    '''interface ClaimedTurn {
  bindingId: string;
  activityId: string;
  environment: ChatGptTurnEnvironment & { expiresAt?: number };
  contextTransport?: ChatGptWebMcpContextManifest;
}''',
)

replace_once(
    "src/adapters/chatgpt-web/mcp-server.ts",
    '''        const directMatches = safeVisibleTools(bound, contract).filter(tool => !needle || [
          wireName(tool),
          tool.name,
          tool.namespace ?? "",
          tool.description,
        ].join("\\n").toLowerCase().includes(needle));
        const directPage = directMatches.slice(offset, offset + limit).map(tool => ({
          wire_name: wireName(tool),
          name: tool.name,
          namespace: tool.namespace ?? null,
          description: browserToolDescription(tool),
          kind: tool.freeform ? "freeform" : tool.toolSearch ? "tool_search" : "function",
          ...(include_schema ? { parameters: browserToolParameters(tool) } : {}),
        }));''',
    '''        const directMatches = safeVisibleTools(bound, contract).filter(tool => !needle || [
          wireName(tool),
          tool.name,
          tool.namespace ?? "",
          tool.description,
        ].join("\\n").toLowerCase().includes(needle));
        const directDescriptors = directMatches.map(tool => ({
          wire_name: wireName(tool),
          name: tool.name,
          namespace: tool.namespace ?? null,
          description: browserToolDescription(tool),
          kind: tool.freeform ? "freeform" : tool.toolSearch ? "tool_search" : "function",
          ...(include_schema ? { parameters: browserToolParameters(tool) } : {}),
        }));
        const contextDescription = "Read one exact chunk of the canonical Codex task context held locally for this turn.";
        const contextMatches = contract === "native"
          && claimed.contextTransport
          && (!needle || `${CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME}\\n${contextDescription}`.toLowerCase().includes(needle))
          ? [{
            wire_name: CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
            name: CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME,
            namespace: null,
            description: contextDescription,
            kind: "bridge",
            ...(include_schema ? {
              parameters: {
                type: "object",
                additionalProperties: false,
                properties: {
                  context_id: { type: "string", const: claimed.contextTransport.contextId },
                  chunk: { type: "integer", minimum: 0 },
                },
                required: ["context_id", "chunk"],
              },
            } : {}),
          }]
          : [];
        const localMatches = [...contextMatches, ...directDescriptors];
        const directPage = localMatches.slice(offset, offset + limit);''',
)

replace_once(
    "src/adapters/chatgpt-web/mcp-server.ts",
    '''          const nestedOffset = Math.max(0, offset - directMatches.length);
          const nestedLimit = Math.max(0, limit - directPage.length);''',
    '''          const nestedOffset = Math.max(0, offset - localMatches.length);
          const nestedLimit = Math.max(0, limit - directPage.length);''',
)

replace_once(
    "src/adapters/chatgpt-web/mcp-server.ts",
    '''        const page = [...directPage, ...nestedPage];
        const total = directMatches.length + nestedTotal;''',
    '''        const page = [...directPage, ...nestedPage];
        const total = localMatches.length + nestedTotal;''',
)

replace_once(
    "src/adapters/chatgpt-web/mcp-server.ts",
    '''      return withClaimedTurn("codex_tool_call", requestId, extra, async claimed => {
        const bound = claimed.environment;
        const tool = safeVisibleTools(bound, contract)''',
    '''      return withClaimedTurn("codex_tool_call", requestId, extra, async claimed => {
        const bound = claimed.environment;
        if (contract === "native" && wire_name === CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME) {
          if (input !== undefined) throw new Error("Codex MCP context reader accepts structured arguments only");
          if (!claimed.contextTransport) throw new Error("Codex MCP context is unavailable for this turn");
          const contextId = args?.context_id;
          const chunk = args?.chunk;
          if (typeof contextId !== "string" || contextId.length === 0) {
            throw new Error("Codex MCP context reader requires context_id");
          }
          if (!Number.isSafeInteger(chunk) || Number(chunk) < 0) {
            throw new Error("Codex MCP context reader requires a non-negative integer chunk");
          }
          const response = await callTurnBroker<Record<string, unknown>>(options.brokerSocketPath, {
            method: "context_read",
            bindingId: claimed.bindingId,
            contextId,
            chunk: Number(chunk),
          }, 5_000, extra.signal);
          return result(response);
        }
        const tool = safeVisibleTools(bound, contract)''',
)

# index.ts: install (or clear) the broker-owned payload before the prompt can be submitted.
replace_once(
    "src/adapters/chatgpt-web/index.ts",
    '''        const compiled = compileChatGptWebPrompt(
          input,
          turnCapabilities,
          turnToken,
          compileOptionsFor(input),
        );
        // Publish only after preparation succeeds: otherwise its failure revokes the token''',
    '''        const compiled = compileChatGptWebPrompt(
          input,
          turnCapabilities,
          turnToken,
          compileOptionsFor(input),
        );
        if (broker.setContextTransport) {
          await Promise.resolve(broker.setContextTransport(turnToken, compiled.contextTransport));
        } else if (compiled.contextTransport) {
          throw new Error("The active Codex turn broker does not support MCP context transport");
        }
        // Publish only after preparation succeeds: otherwise its failure revokes the token''',
)

# architecture: document the production transport split.
replace_once(
    "docs/architecture.md",
    '''The current compiled Codex task context is inserted as one inline JSON envelope. Image bytes stay
out of the JSON and are attached natively with stable references. The runtime does not create a
context JSONL file, upload a synthetic context document, include prompt hashes, or silently truncate
the envelope. Attachment acceptance and send readiness are verified before the turn begins.''',
    '''Small compiled Codex task contexts are inserted as one inline JSON envelope. In automatic Full
mode, a large canonical envelope is instead held by the turn broker and the browser sends only a
small manifest/bootstrap. The existing `codex_tool_inventory` and `codex_tool_call` MCP ABI exposes
a bridge-reserved `codex_web_context_read` wire name, allowing the active ChatGPT response to read
the exact context in bounded local chunks before it executes the task. No new public MCP tool is
registered, so the `Codex Native2` connector schema identity does not change. Browser-only,
Zero Risk/manual, and compaction transports keep their established paths. Image bytes stay out of
the JSON and are attached natively with stable references. The runtime does not upload a synthetic
context document or silently truncate the envelope. Attachment acceptance and send readiness are
verified before the turn begins.''',
)

print("Applied MCP context transport implementation edits")
