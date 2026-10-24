import { CHATGPT_WEB_PLATFORM_RESERVE_TOKENS, chatGptWebImageTokenReserve } from "../../chatgpt-web-models";
import { estimateTokens } from "../../lib/token-estimate";
import type { CodexUsage } from "../../types";
import type { NineRouterRequest } from "./request";
import type { NineRouterStage } from "./session-manager";

/**
 * ChatGPT Web does not provide authoritative API usage for externally routed turns.
 * Report a conservative, clearly marked tokenizer estimate instead of the zero
 * placeholder that prevents context-aware coding agents from compacting.
 *
 * Count the logical context once, not the transport's multipart acknowledgements:
 * 9Router replays the full Responses history on each tool continuation, whereas
 * the browser may keep those steps in one retained conversation.
 */
export function estimateNineRouterUsage(request: NineRouterRequest, stage: NineRouterStage): CodexUsage {
  const context = JSON.stringify({
    instructions: request.instructions,
    messages: request.history.map(message => ({ role: message.role, text: message.text })),
    available_tools: request.tools.map(tool => tool.name),
    tool_choice: request.toolChoice,
    parallel_tool_calls: request.parallelToolCalls,
  });
  const imageTokens = request.history.reduce((total, message) => total + (message.images ?? [])
    .reduce((imageTotal, image) => imageTotal + chatGptWebImageTokenReserve(image.detail), 0), 0);
  const inputTokens = CHATGPT_WEB_PLATFORM_RESERVE_TOKENS + estimateTokens(context, request.model) + imageTokens;
  const outputTokens = estimateTokens(JSON.stringify({
    text: stage.text,
    tool_calls: stage.calls.map(call => ({ name: call.wireName, arguments: call.arguments ?? {} })),
  }), request.model);
  return { inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, estimated: true };
}
