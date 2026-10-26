import { expect, test } from "bun:test";
import { parseAgentResponsesRequest } from "../src/integrations/agent-responses/request";
import { estimateAgentResponsesUsage } from "../src/integrations/agent-responses/usage";

const model = "test-model";
const stage = { text: "Completed", calls: [] };

test("usage includes every verified MCP image result once, including error results", () => {
  const request = parseAgentResponsesRequest({ model, input: [
    { role: "user", content: "Inspect two image results" },
    { type: "function_call_output", call_id: `call_${"a".repeat(32)}`, output: {
      content: [{ type: "text", text: "First" },
        { type: "image", data: "aGVsbG8=", mimeType: "image/png" }],
    } },
    { type: "function_call_output", call_id: `call_${"b".repeat(32)}`, output: {
      isError: true, content: [{ type: "text", text: "Second" },
        { type: "image", data: "dGVzdA==", mimeType: "image/jpeg" }],
    } },
  ] });
  expect(request.outputs).toHaveLength(2);
  const withoutMcpImages = { ...request, outputs: request.outputs.map(output => ({
    ...output, result: output.result && { ...output.result, content: output.result.content.filter(part =>
      !(part && typeof part === "object" && "type" in part && part.type === "image")) },
  })) };
  const baseline = estimateAgentResponsesUsage(withoutMcpImages, stage);
  const estimated = estimateAgentResponsesUsage(request, stage);
  expect(estimated.inputTokens - baseline.inputTokens).toBe(8_192);
  expect(estimated.outputTokens).toBe(baseline.outputTokens);
  expect(estimated.totalTokens).toBe(estimated.inputTokens + estimated.outputTokens);
  expect(estimated.estimated).toBe(true);
});

test("MCP image usage does not count ordinary text-only tool output as an attachment", () => {
  const plain = parseAgentResponsesRequest({ model, input: [
    { role: "user", content: "Read text" },
    { type: "function_call_output", call_id: `call_${"c".repeat(32)}`, output: {
      content: [{ type: "text", text: "Text only" }],
    } },
  ] });
  expect(plain.outputs[0]?.result?.content).toHaveLength(1);
  const withoutRichResult = { ...plain, outputs: plain.outputs.map(output => ({
    ...output, result: undefined,
  })) };
  expect(estimateAgentResponsesUsage(plain, stage).inputTokens)
    .toBe(estimateAgentResponsesUsage(withoutRichResult, stage).inputTokens);
});
