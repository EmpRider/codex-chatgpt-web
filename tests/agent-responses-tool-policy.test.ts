import { expect, test } from "bun:test";
import { parseAgentResponsesRequest } from "../src/integrations/agent-responses/request";
import { assertAgentResponsesToolArguments, normalizeAgentResponsesTool } from "../src/integrations/agent-responses/tool-policy";

const model = "test-model";
const declared = { type: "function", name: "Read", description: "Read file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } };

test("untrusted declarations reject reserved functions, duplicate names and unsupported tool forms", () => {
  const base = { model, input: "Inspect" };
  for (const name of ["codex_exec", "codex_tool_call", "codex_tool_inventory", "codex_turn_complete",
    "codex_write_stdin", "codex_apply_patch", "codex_native_exec", "codex_compaction_handoff"]) {
    expect(() => normalizeAgentResponsesTool({ ...declared, name }, 0)).toThrow("reserved function name");
  }
  expect(() => parseAgentResponsesRequest({ ...base, tools: [declared, declared] })).toThrow("Duplicate tool name");
  expect(() => parseAgentResponsesRequest({ ...base, tools: Array(257).fill(declared) })).toThrow("up to 256");
  expect(() => normalizeAgentResponsesTool({ ...declared, type: "custom" }, 0)).toThrow("Unsupported tool type");
  expect(() => normalizeAgentResponsesTool({ ...declared, name: "bad name" }, 0)).toThrow("Invalid or reserved");
});

test("Draft 7 and 2020-12 schema arguments are independently validated", () => {
  const draft7 = normalizeAgentResponsesTool(declared, 0);
  expect(() => assertAgentResponsesToolArguments(draft7, { path: "file.ts" })).not.toThrow();
  expect(() => assertAgentResponsesToolArguments(draft7, { path: 123 }))
    .toThrow("violate its advertised JSON Schema");
  expect(() => assertAgentResponsesToolArguments(draft7, {}))
    .toThrow("violate its advertised JSON Schema");
  const draft2020 = normalizeAgentResponsesTool({ ...declared, name: "Agent", strict: true, parameters: {
    $schema: "https://json-schema.org/draft/2020-12/schema", type: "object",
    properties: { labels: { type: "array", prefixItems: [{ type: "string" }, { type: "integer" }], items: false } },
    required: ["labels"], unevaluatedProperties: false,
  } }, 1);
  expect(draft2020.strict).toBe(true);
  expect(() => assertAgentResponsesToolArguments(draft2020, { labels: ["read", 1] })).not.toThrow();
  expect(() => assertAgentResponsesToolArguments(draft2020, { labels: [1, "read"] }))
    .toThrow("violate its advertised JSON Schema");
  expect(() => assertAgentResponsesToolArguments(draft2020, { labels: ["read", 1], hidden: true }))
    .toThrow("violate its advertised JSON Schema");
});

test("invalid schemas, oversized manuals and unadvertised choices fail before execution", () => {
  const base = { model, input: "Inspect", tools: [declared] };
  expect(() => normalizeAgentResponsesTool({ ...declared, parameters: { type: "string" } }, 0))
    .toThrow("requires an object JSON Schema");
  expect(() => normalizeAgentResponsesTool({ ...declared,
    parameters: { type: "object", properties: { x: { type: "not-a-schema-type" } } } }, 0))
    .toThrow("invalid or unsupported JSON Schema");
  expect(() => normalizeAgentResponsesTool({ ...declared, description: "x".repeat(128_001) }, 0))
    .toThrow("exceeds 128000 characters");
  expect(() => normalizeAgentResponsesTool({ ...declared, description: 5 }, 0))
    .toThrow("Invalid function description");
  expect(() => parseAgentResponsesRequest({ ...base, tool_choice: { type: "function", name: "Write" } }))
    .toThrow("not advertised");
  expect(() => parseAgentResponsesRequest({ model, input: "Inspect", tool_choice: "required" }))
    .toThrow("requires declared functions");
  expect(() => parseAgentResponsesRequest({ ...base, tool_choice: { type: "allowed_tools", tools: [] } }))
    .toThrow("Unsupported tool_choice");
  expect(parseAgentResponsesRequest({ ...base, tool_choice: "none" }).toolChoice).toBe("none");
});

test("strict function declaration must be a boolean", () => {
  for (const invalid of ["true", 1, null]) {
    expect(() => normalizeAgentResponsesTool({ ...declared, strict: invalid }, 0))
      .toThrow("strict must be a boolean");
  }
  expect(normalizeAgentResponsesTool({ ...declared, strict: false }, 0).strict).toBeUndefined();
});
