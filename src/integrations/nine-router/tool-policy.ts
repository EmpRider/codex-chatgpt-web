import Ajv from "ajv";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import type { CodexTool } from "../../types";
import { NineRouterRequestError } from "./errors";

// Agent tools can advertise different JSON Schema dialects. In particular,
// Claude Code's Agent tool uses Draft 2020-12, which the default Ajv (Draft 7)
// instance cannot compile. Keep the validators separate: Ajv does not support
// Draft 7 and Draft 2020-12 schemas in the same instance.
const draft7Validator = new Ajv({ strict: false, allErrors: false, validateSchema: true });
const draft2020Validator = new Ajv2020({ strict: false, allErrors: false, validateSchema: true });
addFormats(draft7Validator);
addFormats(draft2020Validator);

// Coding agents may advertise lengthy native tool manuals (notably Claude Code's
// Bash tool). Preserve the entire description for on-demand MCP inventory;
// session-manager sends only a bounded preview to the ChatGPT composer.
const MAX_TOOL_DESCRIPTION_CHARS = 128_000;

function validatorFor(parameters: Record<string, unknown>) {
  return parameters.$schema === "https://json-schema.org/draft/2020-12/schema"
    ? draft2020Validator
    : draft7Validator;
}

const RESERVED_BRIDGE_NAMES = new Set([
  "codex_tool_inventory", "codex_tool_call", "codex_turn_complete", "codex_exec",
  "codex_write_stdin", "codex_apply_patch", "codex_native_exec", "codex_compaction_handoff",
]);

export function normalizeNineRouterTool(value: unknown, index: number): CodexTool {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new NineRouterRequestError(`Invalid tool declaration at index ${index}`);
  }
  const entry = value as Record<string, unknown>;
  if (entry.type !== "function") {
    throw new NineRouterRequestError(`Unsupported tool type at index ${index}`, 422);
  }
  if (typeof entry.name !== "string" || !/^[A-Za-z0-9_.$-]{1,128}$/.test(entry.name)
    || RESERVED_BRIDGE_NAMES.has(entry.name)) {
    throw new NineRouterRequestError(`Invalid or reserved function name at index ${index}`);
  }
  const description = entry.description ?? "";
  if (typeof description !== "string") {
    throw new NineRouterRequestError(`Invalid function description at index ${index}`);
  }
  if (description.length > MAX_TOOL_DESCRIPTION_CHARS) {
    throw new NineRouterRequestError(`Function description at index ${index} exceeds ${MAX_TOOL_DESCRIPTION_CHARS} characters`, 413);
  }
  const parameters = entry.parameters ?? { type: "object", properties: {} };
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)
    || (parameters as Record<string, unknown>).type !== "object") {
    throw new NineRouterRequestError(`Function at index ${index} requires an object JSON Schema`);
  }
  if (JSON.stringify(parameters).length > 64_000) {
    throw new NineRouterRequestError(`Function schema at index ${index} exceeds 64 KB`, 413);
  }
  try { validatorFor(parameters as Record<string, unknown>).compile(parameters); }
  catch { throw new NineRouterRequestError(`Function at index ${index} has an invalid or unsupported JSON Schema`, 422); }
  return { name: entry.name, description, parameters: parameters as Record<string, unknown>,
    ...(entry.strict === true ? { strict: true } : {}) };
}

/** External MCP calls cannot bypass the originating agent's declared JSON Schema. */
export function assertNineRouterToolArguments(tool: CodexTool, args: Record<string, unknown>): void {
  let check;
  try { check = validatorFor(tool.parameters).compile(tool.parameters); }
  catch { throw new Error(`External tool ${tool.name} has an invalid JSON Schema`); }
  if (!check(args)) throw new Error(`Arguments for external agent tool ${tool.name} violate its advertised JSON Schema`);
}
