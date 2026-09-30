import { estimateTokens } from "../lib/token-estimate";
import type { CodexMessage, CodexParsedRequest } from "../types";
import { loadOptimizationSettings } from "./config";

interface HeadroomCompressResponse {
  messages?: Array<Record<string, unknown>>;
  tokens_before?: number;
  tokens_after?: number;
  tokens_saved?: number;
}

interface EligibleMessage {
  index: number;
  role: "assistant" | "tool";
  content: string;
  toolCallId?: string;
}

function textOnly(message: CodexMessage): string | null {
  if (message.role === "toolResult") return typeof message.content === "string" ? message.content : null;
  if (message.role !== "assistant") return null;
  if (message.content.some(part => part.type !== "text")) return null;
  return message.content.map(part => part.type === "text" ? part.text : "").join("\n");
}

function protectedStart(messages: readonly CodexMessage[], recentUserTurns: number): number {
  if (recentUserTurns <= 0) return messages.length;
  let seen = 0;
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]!.role !== "user") continue;
    seen += 1;
    if (seen >= recentUserTurns) return index;
  }
  return 0;
}

export function headroomEligibleMessages(
  parsed: CodexParsedRequest,
  minTokens: number,
  protectRecentTurns: number,
): EligibleMessage[] {
  if (parsed._compactionRequest) return [];
  const protectFrom = protectedStart(parsed.context.messages, protectRecentTurns);
  const result: EligibleMessage[] = [];
  parsed.context.messages.forEach((message, index) => {
    if (index >= protectFrom) return;
    const content = textOnly(message);
    if (!content || estimateTokens(content) < minTokens) return;
    if (message.role === "toolResult") {
      result.push({
        index,
        role: "tool",
        content,
        toolCallId: message.toolCallId,
      });
    } else if (message.role === "assistant") {
      result.push({ index, role: "assistant", content });
    }
  });
  return result;
}

function wireMessage(candidate: EligibleMessage): Record<string, unknown> {
  return candidate.role === "tool"
    ? { role: "tool", tool_call_id: candidate.toolCallId, content: candidate.content }
    : { role: "assistant", content: candidate.content };
}

function applyCompressedContent(
  parsed: CodexParsedRequest,
  candidates: readonly EligibleMessage[],
  output: readonly Record<string, unknown>[],
): boolean {
  if (output.length !== candidates.length) return false;
  for (let position = 0; position < candidates.length; position += 1) {
    const candidate = candidates[position]!;
    const compressed = output[position]!;
    if (compressed.role !== candidate.role || typeof compressed.content !== "string") return false;
    if (candidate.role === "tool" && compressed.tool_call_id !== candidate.toolCallId) return false;
  }
  for (let position = 0; position < candidates.length; position += 1) {
    const candidate = candidates[position]!;
    const compressed = output[position]!.content as string;
    const original = parsed.context.messages[candidate.index]!;
    if (original.role === "toolResult") {
      original.content = compressed;
    } else if (original.role === "assistant") {
      original.content = [{ type: "text", text: compressed }];
    }
  }
  return true;
}

export interface HeadroomOptimizationResult {
  attempted: boolean;
  applied: boolean;
  messageCount: number;
  tokensBefore?: number;
  tokensAfter?: number;
  tokensSaved?: number;
  error?: string;
}

export async function compressParsedContextWithHeadroom(
  parsed: CodexParsedRequest,
  fetchImpl: typeof fetch = fetch,
): Promise<HeadroomOptimizationResult> {
  const settings = loadOptimizationSettings();
  if (!settings.headroom.enabled) return { attempted: false, applied: false, messageCount: 0 };

  const candidates = headroomEligibleMessages(
    parsed,
    settings.headroom.minTokens,
    settings.headroom.protectRecentTurns,
  );
  if (!candidates.length) return { attempted: false, applied: false, messageCount: 0 };

  try {
    const response = await fetchImpl(`http://127.0.0.1:${settings.headroom.port}/v1/compress`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        messages: candidates.map(wireMessage),
        model: parsed.modelId,
        config: {
          mode: "lossy_inline",
          frozen_message_count: 0,
        },
      }),
      signal: AbortSignal.timeout(3_000),
    });
    if (!response.ok) {
      return {
        attempted: true,
        applied: false,
        messageCount: candidates.length,
        error: `HTTP ${response.status}`,
      };
    }
    const payload = await response.json() as HeadroomCompressResponse;
    if (!Array.isArray(payload.messages) || !applyCompressedContent(parsed, candidates, payload.messages)) {
      return {
        attempted: true,
        applied: false,
        messageCount: candidates.length,
        error: "Headroom changed the protected message structure",
      };
    }
    return {
      attempted: true,
      applied: true,
      messageCount: candidates.length,
      ...(Number.isFinite(payload.tokens_before) ? { tokensBefore: payload.tokens_before } : {}),
      ...(Number.isFinite(payload.tokens_after) ? { tokensAfter: payload.tokens_after } : {}),
      ...(Number.isFinite(payload.tokens_saved) ? { tokensSaved: payload.tokens_saved } : {}),
    };
  } catch (error) {
    return {
      attempted: true,
      applied: false,
      messageCount: candidates.length,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}
