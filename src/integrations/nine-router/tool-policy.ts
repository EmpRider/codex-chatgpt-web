import Ajv from "ajv";
import addFormats from "ajv-formats";
import type { CodexTool } from "../../types";
import { NineRouterRequestError } from "./errors";

const validator = new Ajv({ strict: false, allErrors: false, validateSchema: true });
addFormats(validator);

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
    throw new NineRouterRequestError(`Unsupported tool type at index ${index}: ${String(entry.type ?? "missing")}`, 422);
  }
  if (typeof entry.name !== "string" || !/^[A-Za-z0-9_.$-]{1,128}$/.test(entry.name)
    || RESERVED_BRIDGE_NAMES.has(entry.name)) {
    throw new NineRouterRequestError(`Invalid or reserved function name at index ${index}`);
  }
  const description = entry.description ?? "";
  if (typeof description !== "string" || description.length > 12_000) {
    throw new NineRouterRequestError(`Invalid function description for ${entry.name}`);
  }
  const parameters = entry.parameters ?? { type: "object", properties: {} };
  if (!parameters || typeof parameters !== "object" || Array.isArray(parameters)
    || (parameters as Record<string, unknown>).type !== "object") {
    throw new NineRouterRequestError(`Function ${entry.name} requires an object JSON Schema`);
  }
  if (JSON.stringify(parameters).length > 64_000) {
    throw new NineRouterRequestError(`Function ${entry.name} schema exceeds 64 KB`, 413);
  }
  try { validator.compile(parameters); }
  catch { throw new NineRouterRequestError(`Function ${entry.name} has an invalid or unsupported JSON Schema`, 422); }
  return { name: entry.name, description, parameters: parameters as Record<string, unknown>,
    ...(entry.strict === true ? { strict: true } : {}) };
}

/** External MCP calls cannot bypass the originating agent's declared JSON Schema. */
export function assertNineRouterToolArguments(tool: CodexTool, args: Record<string, unknown>): void {
  let check;
  try { check = validator.compile(tool.parameters); }
  catch { throw new Error(`External tool ${tool.name} has an invalid JSON Schema`); }
  if (!check(args)) throw new Error(`Arguments for external agent tool ${tool.name} violate its advertised JSON Schema`);
}
