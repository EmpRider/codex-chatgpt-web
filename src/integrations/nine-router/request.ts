import type { CodexTool } from "../../types";
import type { BrokerToolResult } from "../../adapters/chatgpt-web/turn-broker";
import type { ChatGptWebPromptImage } from "../../adapters/chatgpt-web/prompt";
import { normalizeNineRouterTool } from "./tool-policy";
import { NineRouterRequestError } from "./errors";

export { NineRouterRequestError } from "./errors";

export interface NineRouterToolOutput { callId: string; output: string; isError?: boolean; result?: BrokerToolResult; }
export interface NineRouterRequest {
  model: string;
  instructions: string;
  history: Array<{ role: "user" | "assistant" | "system" | "developer" | "tool"; text: string; images?: ChatGptWebPromptImage[] }>;
  tools: CodexTool[];
  toolChoice: "auto" | "none" | "required" | { name: string };
  parallelToolCalls: boolean;
  outputs: NineRouterToolOutput[];
  /** A new user turn follows earlier, already-completed tool history. */
  newUserAfterToolHistory: boolean;
  stream: boolean;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

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
        throw new NineRouterRequestError("Images must be inline base64 PNG/JPEG/GIF/WebP; remote image links cannot be transported to ChatGPT Web", 422);
      }
      if (url.length > 27_000_000) throw new NineRouterRequestError("One image exceeds ChatGPT Web's 20 MB limit", 413);
      const ref = `${refPrefix}_${index}`;
      images.push({ ref, imageUrl: url, ...(typeof entry.detail === "string" ? { detail: entry.detail } : {}) });
      return `[Attached image: ${ref}]`;
    }
    if (entry.type === "input_image" || entry.type === "image_url" || entry.type === "input_audio" || entry.type === "input_file") {
      throw new NineRouterRequestError(`Unsupported multimodal content block: ${entry.type}`, 422);
    }
    if (entry.type === "input_text" || entry.type === "output_text" || entry.type === "text" || entry.type === "summary_text") {
      if (typeof entry.text !== "string") throw new NineRouterRequestError(`Malformed ${entry.type} block`);
      return entry.text;
    }
    throw new NineRouterRequestError("Unsupported content block", 422);
  }).filter(Boolean).join("\n");
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

function extractMcpOutput(value: Record<string, unknown>): { text: string; result: BrokerToolResult } {
  const rawContent = value.content;
  if (!Array.isArray(rawContent) || rawContent.length > 256) {
    throw new NineRouterRequestError("Structured tool output requires up to 256 MCP content blocks", 422);
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
      && /^[A-Za-z0-9+/]*={0,2}$/.test(block.data) && block.data.length % 4 === 0) {
      if (++imageCount > 10) throw new NineRouterRequestError("A tool result supports at most 10 MCP images", 413);
      imageBytes += Buffer.byteLength(block.data, "base64");
      if (imageBytes > 50_000_000) throw new NineRouterRequestError("Tool result images exceed 50 MB", 413);
      content.push({ type: "image", data: block.data, mimeType: block.mimeType });
      summary.push(`[MCP image supplied: ${block.mimeType}]`);
    } else {
      throw new NineRouterRequestError("Unsupported MCP result media type; no image URLs or file references are fabricated", 422);
    }
  }
  const structuredContent = object(value.structuredContent);
  if (structuredContent && JSON.stringify(structuredContent).length > 2_000_000) {
    throw new NineRouterRequestError("MCP structuredContent exceeds 2 MB", 413);
  }
  return { text: summary.join("\n"), result: { content,
    ...(structuredContent ? { structuredContent } : {}),
    ...(value.isError === true ? { isError: true } : {}),
  } };
}

/** Normalize the standard Responses subset emitted by unmodified 9Router. */
export function parseNineRouterRequest(value: unknown): NineRouterRequest {
  const body = object(value);
  if (!body) throw new NineRouterRequestError("Responses payload must be a JSON object");
  // This adapter carries in-memory browser owners between explicit function_call_output
  // requests; it does not keep OpenAI-side response_id or stored conversation state.
  // Ignoring a stateful reference would risk replaying an agent-side mutation after restart.
  if (body.previous_response_id != null || body.conversation != null) {
    throw new NineRouterRequestError("Stored response/conversation resume is unsupported; send full history or start a new task", 422);
  }
  if (body.background === true) throw new NineRouterRequestError("Background Responses turns are unsupported", 422);
  if (body.parallel_tool_calls !== undefined && typeof body.parallel_tool_calls !== "boolean") {
    throw new NineRouterRequestError("parallel_tool_calls must be a boolean", 422);
  }
  if (typeof body.model !== "string" || body.model.length > 200) throw new NineRouterRequestError("A model ID is required");
  if (body.instructions !== undefined && typeof body.instructions !== "string") {
    throw new NineRouterRequestError("instructions must be a string");
  }
  const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
  if (!Array.isArray(input) || input.length > 2_048) throw new NineRouterRequestError("input must be text or an array of up to 2048 items");
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 256)) {
    throw new NineRouterRequestError("tools must be an array of up to 256 functions");
  }
  const tools: CodexTool[] = (body.tools as unknown[] | undefined ?? []).map(normalizeNineRouterTool);
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new NineRouterRequestError("Duplicate tool name");
    names.add(tool.name);
  }
  let toolChoice: NineRouterRequest["toolChoice"] = "auto";
  const choice = body.tool_choice;
  if (choice !== undefined && choice !== null) {
    if (choice === "auto" || choice === "none" || choice === "required") toolChoice = choice;
    else {
      const selected = object(choice);
      const named = typeof selected?.name === "string" ? selected.name : object(selected?.function)?.name;
      if (selected?.type !== "function" || typeof named !== "string") {
        throw new NineRouterRequestError("Unsupported 9Router tool_choice; expected auto, none, required or a named function", 422);
      }
      toolChoice = { name: named };
    }
  }
  if ((toolChoice === "required" || typeof toolChoice === "object") && tools.length === 0) {
    throw new NineRouterRequestError("Requested tool_choice requires declared functions", 422);
  }
  if (typeof toolChoice === "object" && !names.has(toolChoice.name)) {
    throw new NineRouterRequestError("Required function is not advertised", 422);
  }
  const history: NineRouterRequest["history"] = [];
  const outputs: NineRouterToolOutput[] = [];
  let lastToolResultIndex = -1;
  let lastUserIndex = -1;
  for (const [index, raw] of input.entries()) {
    if (typeof raw === "string") { history.push({ role: "user", text: raw }); lastUserIndex = index; continue; }
    const entry = object(raw);
    if (!entry) throw new NineRouterRequestError(`Invalid input item at index ${index}`);
    if (entry.type === "function_call_output") {
      if (typeof entry.call_id !== "string" || !/^call_[A-Za-z0-9_-]{1,59}$/.test(entry.call_id)) {
        throw new NineRouterRequestError("Invalid tool result call_id");
      }
      const envelope = object(entry.output);
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
        throw new NineRouterRequestError("Malformed historical function call");
      }
      history.push({ role: "assistant", text: `Prior tool call ${entry.call_id} (${entry.name}): ${extractText(entry.arguments)}` });
      continue;
    }
    if (entry.type === "reasoning") {
      // 9Router may round-trip visible reasoning summaries. They are history, not an executable tool.
      const summary = extractText(entry.summary);
      if (summary) history.push({ role: "assistant", text: `[Prior visible reasoning summary]\n${summary}` });
      continue;
    }
    if (entry.role === "user" || entry.role === "assistant" || entry.role === "system" || entry.role === "developer") {
      const images: ChatGptWebPromptImage[] = [];
      const content = extractText(entry.content, images, `r9_${index}`);
      history.push({ role: entry.role, text: content, ...(images.length ? { images } : {}) });
      if (entry.role === "user") lastUserIndex = index;
      continue;
    }
    // Fail closed: silently dropping multimodal or proprietary control items changes agent semantics.
    throw new NineRouterRequestError(`Unsupported Responses input item at index ${index}`);
  }
  const images = history.flatMap(message => message.images ?? []);
  if (images.length > 10) throw new NineRouterRequestError("At most 10 inline images are supported by ChatGPT Web", 413);
  if (images.reduce((total, image) => total + image.imageUrl.length, 0) > 68_000_000) {
    throw new NineRouterRequestError("Total inline images exceed ChatGPT Web's 50 MB attachment budget", 413);
  }
  if (history.length === 0 && outputs.length === 0) throw new NineRouterRequestError("A user input or tool result is required");
  return {
    model: body.model,
    instructions: body.instructions ?? "",
    history,
    tools,
    toolChoice,
    parallelToolCalls: body.parallel_tool_calls !== false,
    outputs,
    newUserAfterToolHistory: lastToolResultIndex >= 0 && lastUserIndex > lastToolResultIndex,
    stream: body.stream === true,
  };
}
