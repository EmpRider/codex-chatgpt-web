import type { CodexTool } from "../../types";
import type { BrokerToolResult } from "../../adapters/chatgpt-web/turn-broker";
import type { ChatGptWebPromptImage } from "../../adapters/chatgpt-web/prompt";
import type { ChatGptWebCodexEffort } from "../../chatgpt-web-models";
import { normalizeAgentResponsesTool } from "./tool-policy";
import { AgentResponsesRequestError } from "./tool-policy";

export { AgentResponsesRequestError } from "./tool-policy";

export interface AgentResponsesToolOutput { callId: string; output: string; isError?: boolean; result?: BrokerToolResult; }
export interface AgentResponsesRequest {
  model: string;
  instructions: string;
  history: Array<{ role: "user" | "assistant" | "system" | "developer" | "tool"; text: string; images?: ChatGptWebPromptImage[] }>;
  tools: CodexTool[];
  toolChoice: "auto" | "none" | "required" | { name: string };
  parallelToolCalls: boolean;
  /** Explicit model reasoning mode; validated against account capabilities before browser Send. */
  reasoningEffort?: ChatGptWebCodexEffort;
  /** Best-effort output budget: ChatGPT Web does not expose an exact token limiter. */
  maxOutputTokens?: number;
  outputs: AgentResponsesToolOutput[];
  /** A new user turn follows earlier, already-completed tool history. */
  newUserAfterToolHistory: boolean;
  stream: boolean;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

const SUPPORTED_REQUEST_FIELDS = new Set([
  "model", "input", "instructions", "tools", "tool_choice", "parallel_tool_calls", "stream",
  "background", "store", "truncation", "previous_response_id", "conversation", "max_output_tokens",
  "reasoning_effort", "reasoning",
]);

const REASONING_EFFORTS = new Set<ChatGptWebCodexEffort>([
  "low", "medium", "high", "xhigh", "max", "ultra",
]);

function extractText(value: unknown, images?: ChatGptWebPromptImage[], refPrefix = "img"): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part, index) => {
    if (typeof part === "string") return part;
    const entry = object(part);
    if (!entry) return "";
    if ((entry.type === "input_image" || entry.type === "image_url") && images) {
      const raw = entry.image_url;
      const url = typeof raw === "string" ? raw : object(raw)?.url;
      if (typeof url !== "string" || !/^data:image\/(?:png|jpe?g|gif|webp);base64,[A-Za-z0-9+/=]+$/i.test(url)) {
        throw new AgentResponsesRequestError("Images must be inline base64 PNG/JPEG/GIF/WebP; remote image links cannot be transported to ChatGPT Web", 422);
      }
      const encoded = url.slice(url.indexOf(",") + 1);
      const decodedBytes = Buffer.byteLength(encoded, "base64");
      if (decodedBytes === 0) {
        throw new AgentResponsesRequestError("Inline image must contain decodable base64 bytes", 422);
      }
      if (decodedBytes > 20_000_000) {
        throw new AgentResponsesRequestError("One image exceeds ChatGPT Web's 20 MB limit", 413);
      }
      if (Buffer.from(encoded, "base64").toString("base64") !== encoded) {
        throw new AgentResponsesRequestError("Inline image must use canonical base64 encoding", 422);
      }
      const ref = `${refPrefix}_${index}`;
      images.push({ ref, imageUrl: url, ...(typeof entry.detail === "string" ? { detail: entry.detail } : {}) });
      return `[Attached image: ${ref}]`;
    }
    if (entry.type === "input_image" || entry.type === "image_url" || entry.type === "input_audio" || entry.type === "input_file") {
      throw new AgentResponsesRequestError(`Unsupported multimodal content block: ${entry.type}`, 422);
    }
    if (entry.type === "input_text" || entry.type === "output_text" || entry.type === "text" || entry.type === "summary_text") {
      if (typeof entry.text !== "string") throw new AgentResponsesRequestError(`Malformed ${entry.type} block`);
      return entry.text;
    }
    throw new AgentResponsesRequestError("Unsupported content block", 422);
  }).filter(Boolean).join("\n");
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function extractRoleContent(value: unknown, images: ChatGptWebPromptImage[], refPrefix: string): string {
  if (typeof value !== "string" && !Array.isArray(value)) {
    throw new AgentResponsesRequestError("Unsupported content block: role content must be text or an array", 422);
  }
  if (Array.isArray(value) && value.some(part => typeof part !== "string" && !object(part))) {
    throw new AgentResponsesRequestError("Unsupported content block", 422);
  }
  return extractText(value, images, refPrefix);
}

function extractMcpOutput(value: Record<string, unknown>): { text: string; result: BrokerToolResult } {
  const rawContent = value.content;
  if (!Array.isArray(rawContent) || rawContent.length > 256) {
    throw new AgentResponsesRequestError("Structured tool output requires up to 256 MCP content blocks", 422);
  }
  const content: Array<Record<string, unknown>> = [];
  const summary: string[] = [];
  let imageCount = 0;
  let imageBytes = 0;
  for (const part of rawContent) {
    const block = object(part);
    if (block?.type === "text" && typeof block.text === "string") {
      content.push({ type: "text", text: block.text });
      summary.push(block.text);
    } else if (block?.type === "image" && typeof block.data === "string"
      && typeof block.mimeType === "string" && /^image\/(?:png|jpeg|gif|webp)$/.test(block.mimeType)
      && /^[A-Za-z0-9+/]*={0,2}$/.test(block.data) && block.data.length % 4 === 0
      && Buffer.byteLength(block.data, "base64") > 0) {
      if (++imageCount > 10) throw new AgentResponsesRequestError("A tool result supports at most 10 MCP images", 413);
      imageBytes += Buffer.byteLength(block.data, "base64");
      if (imageBytes > 50_000_000) throw new AgentResponsesRequestError("Tool result images exceed 50 MB", 413);
      content.push({ type: "image", data: block.data, mimeType: block.mimeType });
      summary.push(`[MCP image supplied: ${block.mimeType}]`);
    } else {
      throw new AgentResponsesRequestError("Unsupported MCP result media type; no image URLs or file references are fabricated", 422);
    }
  }
  const structuredContent = object(value.structuredContent);
  if (structuredContent && JSON.stringify(structuredContent).length > 2_000_000) {
    throw new AgentResponsesRequestError("MCP structuredContent exceeds 2 MB", 413);
  }
  return { text: summary.join("\n"), result: { content,
    ...(structuredContent ? { structuredContent } : {}),
    ...(value.isError === true ? { isError: true } : {}),
  } };
}

/** Normalize the supported OpenAI Responses input subset for external clients. */
export function parseAgentResponsesRequest(value: unknown): AgentResponsesRequest {
  const body = object(value);
  if (!body) throw new AgentResponsesRequestError("Responses payload must be a JSON object");
  const unsupported = Object.keys(body).find(field => !SUPPORTED_REQUEST_FIELDS.has(field));
  if (unsupported !== undefined) {
    // Only reflect a bounded field name, never its potentially sensitive value.
    throw new AgentResponsesRequestError(`Unsupported Responses request field: ${JSON.stringify(unsupported.slice(0, 80))}`, 400);
  }
  // This adapter carries in-memory browser owners between explicit function_call_output
  // requests; it does not keep OpenAI-side response_id or stored conversation state.
  // Ignoring a stateful reference would risk replaying an agent-side mutation after restart.
  if (body.previous_response_id != null || body.conversation != null) {
    throw new AgentResponsesRequestError("Stored response/conversation resume is unsupported; send full history or start a new task", 422);
  }
  if (body.store !== undefined && body.store !== false) {
    throw new AgentResponsesRequestError("Stored Responses are unsupported; store must be false", 400);
  }
  if (body.truncation !== undefined && body.truncation !== "disabled") {
    throw new AgentResponsesRequestError("Automatic or custom truncation is unsupported; truncation must be disabled", 400);
  }
  if (body.background !== undefined && typeof body.background !== "boolean") {
    throw new AgentResponsesRequestError("background must be a boolean", 422);
  }
  if (body.background === true) throw new AgentResponsesRequestError("Background Responses turns are unsupported", 422);
  if (body.stream !== undefined && typeof body.stream !== "boolean") {
    throw new AgentResponsesRequestError("stream must be a boolean", 422);
  }
  if (body.parallel_tool_calls !== undefined && typeof body.parallel_tool_calls !== "boolean") {
    throw new AgentResponsesRequestError("parallel_tool_calls must be a boolean", 422);
  }
  if (body.max_output_tokens !== undefined
    && (!Number.isSafeInteger(body.max_output_tokens) || (body.max_output_tokens as number) < 1)) {
    throw new AgentResponsesRequestError("max_output_tokens must be a positive integer", 422);
  }
  const reasoning = body.reasoning === undefined ? undefined : object(body.reasoning);
  if (body.reasoning !== undefined && (!reasoning
    || Object.keys(reasoning).some(key => key !== "effort"))) {
    throw new AgentResponsesRequestError("reasoning must contain only the supported effort field", 400);
  }
  if (body.reasoning_effort !== undefined && reasoning?.effort !== undefined
    && body.reasoning_effort !== reasoning.effort) {
    throw new AgentResponsesRequestError("reasoning_effort and reasoning.effort must match", 400);
  }
  const requestedEffort = body.reasoning_effort === undefined ? reasoning?.effort : body.reasoning_effort;
  if (requestedEffort !== undefined && !REASONING_EFFORTS.has(requestedEffort as ChatGptWebCodexEffort)) {
    throw new AgentResponsesRequestError("Unsupported reasoning effort; expected low, medium, high, xhigh, max or ultra", 422);
  }
  if (typeof body.model !== "string" || !body.model.trim() || body.model.length > 200) {
    throw new AgentResponsesRequestError("A model ID is required");
  }
  if (body.instructions !== undefined && typeof body.instructions !== "string") {
    throw new AgentResponsesRequestError("instructions must be a string");
  }
  const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
  if (!Array.isArray(input) || input.length > 2_048) throw new AgentResponsesRequestError("input must be text or an array of up to 2048 items");
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 256)) {
    throw new AgentResponsesRequestError("tools must be an array of up to 256 functions");
  }
  const tools: CodexTool[] = (body.tools as unknown[] | undefined ?? []).map(normalizeAgentResponsesTool);
  // Keep even agent-generated tool manuals bounded in aggregate. They remain
  // intact in the broker inventory; only their initial prompt previews shrink.
  if (tools.reduce((sum, tool) => sum + tool.description.length, 0) > 2_000_000) {
    throw new AgentResponsesRequestError("Function descriptions exceed the 2,000,000-character aggregate limit", 413);
  }
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new AgentResponsesRequestError("Duplicate tool name");
    names.add(tool.name);
  }
  let toolChoice: AgentResponsesRequest["toolChoice"] = "auto";
  const choice = body.tool_choice;
  if (choice !== undefined && choice !== null) {
    if (choice === "auto" || choice === "none" || choice === "required") toolChoice = choice;
    else {
      const selected = object(choice);
      const nested = object(selected?.function);
      const named = typeof selected?.name === "string" ? selected.name : nested?.name;
      if (selected?.type === "function" && (Object.keys(selected).some(key => key !== "type" && key !== "name" && key !== "function")
        || (selected.name !== undefined && selected.function !== undefined)
        || (selected.function !== undefined && (!nested || Object.keys(nested).some(key => key !== "name"))))) {
        throw new AgentResponsesRequestError("Unsupported named tool_choice controls", 400);
      }
      if (selected?.type !== "function" || typeof named !== "string") {
        throw new AgentResponsesRequestError("Unsupported tool_choice; expected auto, none, required or a named function", 422);
      }
      toolChoice = { name: named };
    }
  }
  if ((toolChoice === "required" || typeof toolChoice === "object") && tools.length === 0) {
    throw new AgentResponsesRequestError("Requested tool_choice requires declared functions", 422);
  }
  if (typeof toolChoice === "object" && !names.has(toolChoice.name)) {
    throw new AgentResponsesRequestError("Required function is not advertised", 422);
  }
  const history: AgentResponsesRequest["history"] = [];
  const outputs: AgentResponsesToolOutput[] = [];
  let lastToolResultIndex = -1;
  let lastUserIndex = -1;
  for (const [index, raw] of input.entries()) {
    if (typeof raw === "string") { history.push({ role: "user", text: raw }); lastUserIndex = index; continue; }
    const entry = object(raw);
    if (!entry) throw new AgentResponsesRequestError(`Invalid input item at index ${index}`);
    if (entry.type === "function_call_output") {
      if (typeof entry.call_id !== "string" || !/^call_[A-Za-z0-9_-]{1,59}$/.test(entry.call_id)) {
        throw new AgentResponsesRequestError("Invalid tool result call_id");
      }
      if (!Object.hasOwn(entry, "output") || entry.output === null || entry.output === undefined) {
        throw new AgentResponsesRequestError("Tool result output is required", 422);
      }
      const envelope = object(entry.output);
      if ([entry.is_error, entry.isError, envelope?.isError]
        .some(flag => flag !== undefined && typeof flag !== "boolean")) {
        throw new AgentResponsesRequestError("Tool result error flags must be booleans", 422);
      }
      const richResult = envelope && Array.isArray(envelope.content) ? extractMcpOutput(envelope) : undefined;
      const toolText = richResult?.text ?? extractText(entry.output);
      const isError = entry.is_error === true || entry.isError === true || envelope?.isError === true;
      outputs.push({ callId: entry.call_id, output: toolText, ...(isError ? { isError: true } : {}),
        ...(richResult ? { result: richResult.result } : {}),
      });
      history.push({ role: "tool", text: `Tool ${isError ? "error" : "result"} ${entry.call_id}:\n${toolText}` });
      lastToolResultIndex = index;
      continue;
    }
    if (entry.type === "function_call") {
      if (typeof entry.name !== "string" || typeof entry.call_id !== "string") {
        throw new AgentResponsesRequestError("Malformed historical function call");
      }
      history.push({ role: "assistant", text: `Prior tool call ${entry.call_id} (${entry.name}): ${extractText(entry.arguments)}` });
      continue;
    }
    if (entry.type === "reasoning") {
      // Clients may round-trip visible reasoning summaries. They are history, not an executable tool.
      const summary = extractText(entry.summary);
      if (summary) history.push({ role: "assistant", text: `[Prior visible reasoning summary]\n${summary}` });
      continue;
    }
    if (entry.role === "user" || entry.role === "assistant" || entry.role === "system" || entry.role === "developer") {
      const images: ChatGptWebPromptImage[] = [];
      const content = extractRoleContent(entry.content, images, `input_${index}`);
      history.push({ role: entry.role, text: content, ...(images.length ? { images } : {}) });
      if (entry.role === "user") lastUserIndex = index;
      continue;
    }
    // Fail closed: silently dropping multimodal or proprietary control items changes agent semantics.
    throw new AgentResponsesRequestError(`Unsupported Responses input item at index ${index}`);
  }
  const images = history.flatMap(message => message.images ?? []);
  if (images.length > 10) throw new AgentResponsesRequestError("At most 10 inline images are supported by ChatGPT Web", 413);
  if (images.reduce((total, image) => total + image.imageUrl.length, 0) > 68_000_000) {
    throw new AgentResponsesRequestError("Total inline images exceed ChatGPT Web's 50 MB attachment budget", 413);
  }
  if (history.length === 0 && outputs.length === 0) throw new AgentResponsesRequestError("A user input or tool result is required");
  return {
    model: body.model,
    instructions: body.instructions ?? "",
    history,
    tools,
    toolChoice,
    parallelToolCalls: body.parallel_tool_calls !== false,
    ...(requestedEffort === undefined ? {} : { reasoningEffort: requestedEffort as ChatGptWebCodexEffort }),
    ...(body.max_output_tokens === undefined ? {} : { maxOutputTokens: body.max_output_tokens as number }),
    outputs,
    newUserAfterToolHistory: lastToolResultIndex >= 0 && lastUserIndex > lastToolResultIndex,
    stream: body.stream === true,
  };
}
