import { expect, test } from "bun:test";
import { AgentResponsesRequestError, parseAgentResponsesRequest } from "../src/integrations/agent-responses/request";
import { estimateAgentResponsesUsage } from "../src/integrations/agent-responses/usage";

const model = "test-model";
const declared = { type: "function", name: "Read", description: "Read a file",
  parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } };
const callId = `call_${"a".repeat(32)}`;

test("generic Responses input preserves roles, tool history and a later user turn", () => {
  const parsed = parseAgentResponsesRequest({ model, instructions: "Follow declared permissions", stream: true,
    parallel_tool_calls: false, tools: [declared], tool_choice: { type: "function", name: "Read" }, input: [
      { role: "system", content: "Project rules" },
      { role: "developer", content: "Do not write" },
      { role: "user", content: [{ type: "input_text", text: "Read file" }] },
      { type: "function_call", call_id: callId, name: "Read", arguments: '{"path":"x"}' },
      { type: "function_call_output", call_id: callId, output: "file data" },
      { type: "reasoning", summary: [{ type: "summary_text", text: "Visible summary" }] },
      { role: "assistant", content: [{ type: "output_text", text: "Found it" }] },
      { role: "user", content: "Continue" },
    ] });
  expect(parsed).toMatchObject({ model, instructions: "Follow declared permissions", stream: true,
    parallelToolCalls: false, toolChoice: { name: "Read" }, newUserAfterToolHistory: true,
    outputs: [{ callId, output: "file data" }], tools: [{ name: "Read", parameters: declared.parameters }] });
  expect(parsed.history.map(item => item.role)).toEqual([
    "system", "developer", "user", "assistant", "tool", "assistant", "assistant", "user",
  ]);
  expect(parsed.history[3]?.text).toContain('{"path":"x"}');
  expect(parsed.history[4]?.text).toContain("Tool result");
  expect(parsed.history[5]?.text).toContain("Visible summary");
  expect(JSON.stringify(parsed)).not.toContain("sandboxPolicy");
});

test("string prompts normalize with existing defaults and tool results do not imply a new turn", () => {
  expect(parseAgentResponsesRequest({ model, input: "Hi" })).toMatchObject({
    model, instructions: "", history: [{ role: "user", text: "Hi" }], outputs: [], tools: [],
    toolChoice: "auto", parallelToolCalls: true, stream: false, newUserAfterToolHistory: false,
  });
  expect(parseAgentResponsesRequest({ model, input: [
    { role: "user", content: "Run" }, { type: "function_call_output", call_id: callId, output: "done" },
  ] }).newUserAfterToolHistory).toBe(false);
});

test("unsupported stateful or control inputs fail closed with classified errors", () => {
  const base = { model, input: "Hi" };
  for (const override of [{ previous_response_id: "resp_123" }, { conversation: "conv_123" },
    { background: true }, { parallel_tool_calls: "false" },
    { input: [{ type: "opaque_control", content: "hidden" }] },
    { input: [{ role: "user", content: [{ type: "input_audio", data: "AA==" }] }] }]) {
    expect(() => parseAgentResponsesRequest({ ...base, ...override })).toThrow(AgentResponsesRequestError);
  }
  expect(() => parseAgentResponsesRequest({ ...base, previous_response_id: "resp_123" }))
    .toThrow("Stored response/conversation resume is unsupported");
  expect(() => parseAgentResponsesRequest({ ...base, input: Array(2_049).fill("x") }))
    .toThrow("up to 2048");
  expect(() => parseAgentResponsesRequest({ model, input: [] })).toThrow("user input or tool result");
});

test("request control booleans and model IDs cannot silently change meaning", () => {
  const base = { model, input: "Hi" };
  for (const invalid of ["true", 1, null]) {
    for (const field of ["stream", "background"] as const) {
      expect(() => parseAgentResponsesRequest({ ...base, [field]: invalid }))
        .toThrow(AgentResponsesRequestError);
    }
  }
  expect(() => parseAgentResponsesRequest({ ...base, background: true }))
    .toThrow("Background Responses turns are unsupported");
  expect(parseAgentResponsesRequest({ ...base, background: false, stream: false }).stream).toBe(false);
  for (const invalidModel of ["", " ", "\n\t "]) {
    expect(() => parseAgentResponsesRequest({ ...base, model: invalidModel }))
      .toThrow("A model ID is required");
  }
});

test("unsupported persisted responses and automatic truncation fail with HTTP 400", () => {
  const base = { model, input: "Hi" };
  for (const unsupported of [{ store: true }, { truncation: "auto" },
    { store: "true" }, { truncation: "other" }]) {
    let rejection: unknown;
    try { parseAgentResponsesRequest({ ...base, ...unsupported }); }
    catch (error) { rejection = error; }
    expect(rejection).toBeInstanceOf(AgentResponsesRequestError);
    expect((rejection as AgentResponsesRequestError).status).toBe(400);
  }
  const unstored = parseAgentResponsesRequest({ ...base, store: false, truncation: "disabled" });
  expect(unstored.history).toEqual([{ role: "user", text: "Hi" }]);
});

test("unsupported semantic request controls cannot be silently ignored", () => {
  const base = { model, input: "Hi" };
  for (const unsupported of [
    { temperature: 0.2 }, { top_p: 0.8 },
    { text: { format: { type: "json_object" } } }, { reasoning: { summary: "detailed" } },
    { unknown_control: { mode: "privileged" } },
  ]) {
    let rejection: unknown;
    try { parseAgentResponsesRequest({ ...base, ...unsupported }); }
    catch (error) { rejection = error; }
    expect(rejection).toBeInstanceOf(AgentResponsesRequestError);
    expect((rejection as AgentResponsesRequestError).status).toBe(400);
  }
  expect(parseAgentResponsesRequest({ ...base, stream: false, parallel_tool_calls: false }).stream).toBe(false);
});

test("Responses reasoning effort supports flat and nested forms without silently changing semantics", () => {
  const base = { model, input: "Hi" };
  expect(parseAgentResponsesRequest({ ...base, reasoning_effort: "max" }).reasoningEffort).toBe("max");
  expect(parseAgentResponsesRequest({ ...base, reasoning: { effort: "high" } }).reasoningEffort).toBe("high");
  expect(parseAgentResponsesRequest({ ...base, reasoning_effort: "medium", reasoning: { effort: "medium" } })
    .reasoningEffort).toBe("medium");
  for (const invalid of [null, 2, "extreme", "HIGH"]) {
    expect(() => parseAgentResponsesRequest({ ...base, reasoning_effort: invalid })).toThrow(AgentResponsesRequestError);
  }
  expect(() => parseAgentResponsesRequest({ ...base, reasoning_effort: "max", reasoning: { effort: "low" } }))
    .toThrow("reasoning_effort and reasoning.effort must match");
  expect(() => parseAgentResponsesRequest({ ...base, reasoning: { effort: "high", summary: "auto" } }))
    .toThrow("reasoning must contain only the supported effort field");
});

test("Responses accepts 9Router's translated max_tokens model probe as an output budget", () => {
  const request = parseAgentResponsesRequest({
    model, input: [{ type: "message", role: "user", content: [{ type: "input_text", text: "hi" }] }],
    instructions: "", stream: true, store: false, max_output_tokens: 1024,
  });
  expect(request).toMatchObject({ maxOutputTokens: 1024, stream: true, history: [{ role: "user", text: "hi" }] });
  for (const invalid of [0, -1, 1.5, "1024", null, Number.MAX_SAFE_INTEGER + 1]) {
    expect(() => parseAgentResponsesRequest({ model, input: "Hi", max_output_tokens: invalid }))
      .toThrow("max_output_tokens must be a positive integer");
  }
  expect(() => parseAgentResponsesRequest({ model, input: "Hi", unknown_control: true }))
    .toThrow('Unsupported Responses request field: "unknown_control"');
});

test("named tool choice cannot smuggle unsupported selection controls", () => {
  const base = { model, input: "Hi", tools: [declared] };
  for (const choice of [
    { type: "function", name: "Read", budget: 999 },
    { type: "function", function: { name: "Read", extra: "write" } },
    { type: "function", name: "Read", function: { name: "Write" } },
  ]) {
    let rejection: unknown;
    try { parseAgentResponsesRequest({ ...base, tool_choice: choice }); }
    catch (error) { rejection = error; }
    expect(rejection).toBeInstanceOf(AgentResponsesRequestError);
    expect((rejection as AgentResponsesRequestError).status).toBe(400);
  }
  expect(parseAgentResponsesRequest({ ...base, tool_choice: { type: "function",
    function: { name: "Read" } } }).toolChoice).toEqual({ name: "Read" });
});

test("single-object role content is not silently JSON-stringified into a user instruction", () => {
  expect(() => parseAgentResponsesRequest({ model, input: [{ role: "user",
    content: { type: "input_audio", data: "AA==" } }] }))
    .toThrow("Unsupported content block");
  expect(() => parseAgentResponsesRequest({ model, input: [{ role: "assistant",
    content: { type: "unknown_control", hidden: true } }] }))
    .toThrow("Unsupported content block");
  const parsed = parseAgentResponsesRequest({ model, input: [
    { type: "function_call", name: "Read", call_id: callId, arguments: { path: "readme.md" } },
  ] });
  expect(parsed.history[0]?.text).toContain('{"path":"readme.md"}');
});

test("role content rejects nontext primitives and malformed array parts", () => {
  const request = (content: unknown) => parseAgentResponsesRequest({ model, input: [
    { role: "user", content },
  ] });
  for (const content of [123, true, null, ["hello", 42],
    [{ type: "input_text", text: "valid" }, null]]) {
    expect(() => request(content)).toThrow(AgentResponsesRequestError);
  }
  expect(request(["hello", { type: "input_text", text: "world" }]).history[0]?.text)
    .toBe("hello\nworld");
});

test("image content keeps inline bytes in order and rejects remote URLs", () => {
  const url = "data:image/png;base64,aGVsbG8=";
  const parsed = parseAgentResponsesRequest({ model, input: [
    { role: "user", content: [{ type: "input_text", text: "Inspect" },
      { type: "input_image", image_url: url, detail: "high" }] },
  ] });
  expect(parsed.history[0]).toEqual({ role: "user", text: "Inspect\n[Attached image: input_0_1]",
    images: [{ ref: "input_0_1", imageUrl: url, detail: "high" }] });
  expect(() => parseAgentResponsesRequest({ model, input: [
    { role: "user", content: [{ type: "image_url", image_url: "https://example.org/private.png" }] },
  ] })).toThrow("remote image links");
});

test("inline image base64 must decode to at least one byte in canonical form", () => {
  const request = (encoded: string) => parseAgentResponsesRequest({ model, input: [
    { role: "user", content: [{ type: "input_image", image_url: `data:image/png;base64,${encoded}` }] },
  ] });
  // A decodes to zero bytes; AA is missing required padding; AB== has nonzero pad bits.
  for (const invalid of ["A", "AA", "AB==", "A===", "@@@", ""]) {
    let rejection: unknown;
    try { request(invalid); } catch (error) { rejection = error; }
    expect(rejection).toBeInstanceOf(AgentResponsesRequestError);
    expect((rejection as AgentResponsesRequestError).status).toBe(422);
  }
  expect(request("AA==").history[0]?.images?.[0]?.imageUrl).toBe("data:image/png;base64,AA==");
});

test("inline image size is bounded by decoded bytes, not approximate URL length", () => {
  // 26,666,668 base64 characters decode to 20,000,001 bytes.
  const overLimit = `data:image/png;base64,${"A".repeat(26_666_668)}`;
  let rejection: unknown;
  try {
    parseAgentResponsesRequest({ model, input: [{ role: "user", content: [
      { type: "input_image", image_url: overLimit },
    ] }] });
  } catch (error) { rejection = error; }
  expect(rejection).toBeInstanceOf(AgentResponsesRequestError);
  expect((rejection as AgentResponsesRequestError).status).toBe(413);
  expect((rejection as Error).message).toContain("20 MB limit");
});

test("structured MCP tool output preserves image and error evidence; malformed media is rejected", () => {
  const request = (output: unknown, extra: Record<string, unknown> = {}) =>
    parseAgentResponsesRequest({ model, input: [{ role: "user", content: "Review" },
      { type: "function_call_output", call_id: callId, output, ...extra }] });
  const parsed = request({ isError: true, structuredContent: { count: 2 }, content: [
    { type: "text", text: "Preview:" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
  ] });
  expect(parsed.outputs).toEqual([{ callId, isError: true, output: "Preview:\n[MCP image supplied: image/png]",
    result: { isError: true, structuredContent: { count: 2 }, content: [
      { type: "text", text: "Preview:" }, { type: "image", data: "aGVsbG8=", mimeType: "image/png" },
    ] } }]);
  expect(parsed.history[1]?.text).toContain("Tool error");
  expect(request("Error is in the file").outputs[0]?.isError).toBeUndefined();
  expect(request("failed", { is_error: true }).outputs[0]?.isError).toBe(true);
  expect(() => request({ content: [{ type: "image", image_url: "https://example.org" }] }))
    .toThrow("no image URLs or file references are fabricated");
});

test("zero-byte MCP images and nonboolean error flags fail closed", () => {
  const request = (output: unknown, extra: Record<string, unknown> = {}) =>
    parseAgentResponsesRequest({ model, input: [{ role: "user", content: "Review" },
      { type: "function_call_output", call_id: callId, output, ...extra }] });
  expect(() => request({ content: [{ type: "image", data: "", mimeType: "image/png" }] }))
    .toThrow("Unsupported MCP result media type");
  for (const flags of [{ isError: "true" }, { is_error: "true" }]) {
    expect(() => request("failed", flags)).toThrow(AgentResponsesRequestError);
  }
  expect(() => request({ isError: "true", content: [{ type: "text", text: "failed" }] }))
    .toThrow(AgentResponsesRequestError);
  expect(request("okay", { is_error: false }).outputs[0]?.isError).toBeUndefined();
});

test("missing and null tool outputs cannot be acknowledged as successful empty tool results", () => {
  for (const entry of [
    { type: "function_call_output", call_id: callId },
    { type: "function_call_output", call_id: callId, output: null },
  ]) {
    expect(() => parseAgentResponsesRequest({ model, input: [
      { role: "user", content: "Run" }, entry,
    ] })).toThrow("Tool result output is required");
  }
  expect(parseAgentResponsesRequest({ model, input: [
    { role: "user", content: "Run" },
    { type: "function_call_output", call_id: callId, output: "" },
  ] }).outputs[0]?.output).toBe("");
});

test("conservative usage estimate counts logical history, output and inline images", () => {
  const text = parseAgentResponsesRequest({ model, input: "Hi" });
  const image = parseAgentResponsesRequest({ model, input: [{ role: "user", content: [
    { type: "input_text", text: "Hi" }, { type: "input_image", image_url: "data:image/png;base64,aGVsbG8=" },
  ] }] });
  const stage = { text: "Done", calls: [{ wireName: "Read", arguments: { path: "a" } }] };
  const usage = estimateAgentResponsesUsage(text, stage);
  expect(usage).toMatchObject({ estimated: true });
  expect(usage.inputTokens).toBeGreaterThan(8_192);
  expect(usage.outputTokens).toBeGreaterThan(0);
  expect(usage.totalTokens).toBe(usage.inputTokens + usage.outputTokens);
  expect(estimateAgentResponsesUsage(image, stage).inputTokens).toBeGreaterThan(usage.inputTokens);
});
