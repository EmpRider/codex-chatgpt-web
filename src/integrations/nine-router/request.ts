import type { CodexTool } from "../../types";

export class NineRouterRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

export interface NineRouterToolOutput { callId: string; output: string; }
export interface NineRouterRequest {
  model: string;
  instructions: string;
  history: Array<{ role: "user" | "assistant" | "system" | "developer" | "tool"; text: string }>;
  tools: CodexTool[];
  outputs: NineRouterToolOutput[];
  /** A new user turn follows earlier, already-completed tool history. */
  newUserAfterToolHistory: boolean;
  stream: boolean;
}

const object = (value: unknown): Record<string, unknown> | undefined =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : undefined;

function extractText(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map(part => {
    if (typeof part === "string") return part;
    const entry = object(part);
    if (!entry) return "";
    if (entry.type === "input_image" || entry.type === "image_url" || entry.type === "input_audio" || entry.type === "input_file") {
      throw new NineRouterRequestError(`Unsupported multimodal content block: ${entry.type}`, 422);
    }
    if (typeof entry.text === "string") return entry.text;
    if (typeof entry.output === "string") return entry.output;
    return "";
  }).filter(Boolean).join("\n");
  if (value === null || value === undefined) return "";
  return JSON.stringify(value);
}

/** Normalize the standard Responses subset emitted by unmodified 9Router. */
export function parseNineRouterRequest(value: unknown): NineRouterRequest {
  const body = object(value);
  if (!body) throw new NineRouterRequestError("Responses payload must be a JSON object");
  if (typeof body.model !== "string" || body.model.length > 200) throw new NineRouterRequestError("A model ID is required");
  if (body.instructions !== undefined && typeof body.instructions !== "string") {
    throw new NineRouterRequestError("instructions must be a string");
  }
  const input = typeof body.input === "string" ? [{ role: "user", content: body.input }] : body.input;
  if (!Array.isArray(input) || input.length > 2_048) throw new NineRouterRequestError("input must be text or an array of up to 2048 items");
  if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.length > 256)) {
    throw new NineRouterRequestError("tools must be an array of up to 256 functions");
  }
  const tools: CodexTool[] = (body.tools as unknown[] | undefined ?? []).map((raw, index) => {
    const entry = object(raw);
    if (!entry || entry.type !== "function" || typeof entry.name !== "string"
      || !/^[A-Za-z0-9_.$-]{1,128}$/.test(entry.name)
      || typeof entry.description !== "string" || entry.description.length > 12_000) {
      throw new NineRouterRequestError(`Unsupported function tool at index ${index}`);
    }
    const parameters = entry.parameters ?? { type: "object", properties: {} };
    if (!object(parameters)) throw new NineRouterRequestError(`Invalid parameters for ${entry.name}`);
    return { name: entry.name, description: entry.description, parameters: parameters as Record<string, unknown> };
  });
  const names = new Set<string>();
  for (const tool of tools) {
    if (names.has(tool.name)) throw new NineRouterRequestError(`Duplicate tool: ${tool.name}`);
    names.add(tool.name);
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
      if (typeof entry.call_id !== "string" || !/^call_[A-Za-z0-9_-]{20,128}$/.test(entry.call_id)) {
        throw new NineRouterRequestError("Invalid tool result call_id");
      }
      outputs.push({ callId: entry.call_id, output: extractText(entry.output) });
      history.push({ role: "tool", text: `Tool result ${entry.call_id}:\n${extractText(entry.output)}` });
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
      history.push({ role: entry.role, text: extractText(entry.content) });
      if (entry.role === "user") lastUserIndex = index;
      continue;
    }
    // Fail closed: silently dropping multimodal or proprietary control items changes agent semantics.
    throw new NineRouterRequestError(`Unsupported Responses input item at index ${index}`);
  }
  if (history.length === 0 && outputs.length === 0) throw new NineRouterRequestError("A user input or tool result is required");
  return {
    model: body.model,
    instructions: body.instructions ?? "",
    history,
    tools,
    outputs,
    newUserAfterToolHistory: lastToolResultIndex >= 0 && lastUserIndex > lastToolResultIndex,
    stream: body.stream === true,
  };
}
