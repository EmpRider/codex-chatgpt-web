import { expect, test } from "bun:test";
import { setImmediate } from "node:timers/promises";
import { parseRequest } from "../src/responses/parser";
import * as state from "../src/responses/state";

function withoutTimestamps(value: unknown): unknown {
  return JSON.parse(JSON.stringify(value, (key, item) => key === "timestamp" || key === "_replayPrefixLen" ? undefined : item));
}

async function prepared(input: unknown[], output: unknown[] = []) {
  const id = `prepared-${crypto.randomUUID()}`;
  state.rememberResponseState({ model: "old-model", input }, { id, output, status: "completed" });
  for (let i = 0; i < 8; i++) await setImmediate();
  return id;
}

test("completed history is prepared in idle time and next request reuses it with fresh options", async () => {
  expect(typeof (state as any).preparedResponseHistoryStats).toBe("function");
  const id = await prepared([
    { role: "system", content: "history policy" },
    { role: "user", content: "first" },
    { type: "function_call", call_id: "call_1", name: "read", arguments: '{"path":"old"}' },
  ]);
  const body: any = state.expandPreviousResponseInput({
    model: "new-model", previous_response_id: id, instructions: "fresh policy", reasoning: { effort: "high" },
    tools: [{ type: "function", name: "current", parameters: { type: "object" } }],
    input: [{ type: "function_call_output", call_id: "call_1", output: "result" }],
  });
  const before = (state as any).preparedResponseHistoryStats().hits;
  const actual = parseRequest(body);
  expect((state as any).preparedResponseHistoryStats().hits).toBe(before + 1);
  const cold = parseRequest(structuredClone(body));
  expect(withoutTimestamps(actual)).toEqual(withoutTimestamps(cold));
  expect(actual.context.systemPrompt).toEqual(["fresh policy", "history policy"]);
  expect(actual.options.reasoning).toBe("high");
  expect(actual.context.messages.find(message => message.role === "assistant")).toMatchObject({ model: "new-model" });
});

test("prepared boundary reasoning and assistant tail remain isolated between branches", async () => {
  const id = await prepared([
    { role: "assistant", content: "before tools" },
    { type: "reasoning", summary: [{ type: "summary_text", text: "pending reasoning" }] },
  ]);
  const makeBody = (callId: string): any => state.expandPreviousResponseInput({
    model: "model", previous_response_id: id,
    input: [{ type: "function_call", name: "read", call_id: callId, arguments: "{}" }],
  });
  const first = parseRequest(makeBody("first"));
  first.context.messages[0]!.content = "mutated by adapter" as any;
  const body = makeBody("second");
  expect(withoutTimestamps(parseRequest(body))).toEqual(withoutTimestamps(parseRequest(structuredClone(body))));
});

test("changed replayed input invalidates prepared state and still validates malformed history", async () => {
  const id = await prepared([{ role: "user", content: "original" }]);
  const body: any = state.expandPreviousResponseInput({ model: "model", previous_response_id: id, input: "next" });
  body.input[0] = { role: "user", content: 123 };
  expect(() => parseRequest(body)).toThrow("responses parse error");
});

test("prepared tool search history merges with current tools and preserves compaction and image content", async () => {
  const id = await prepared([
    { type: "tool_search_call", call_id: "search", arguments: {} },
    { type: "tool_search_output", call_id: "search", tools: [{ type: "function", name: "read", description: "old", parameters: {} }] },
    { type: "compaction_trigger" },
    { role: "user", content: [{ type: "input_image", image_url: "data:image/png;base64,AAAA", detail: "original" }] },
  ]);
  const body: any = state.expandPreviousResponseInput({ model: "current", previous_response_id: id,
    tools: [{ type: "function", name: "read", description: "fresh", parameters: {} }], input: "next" });
  const actual = parseRequest(body);
  expect(withoutTimestamps(actual)).toEqual(withoutTimestamps(parseRequest(structuredClone(body))));
  expect(actual.context.tools?.[0]?.description).toBe("fresh");
  expect(actual._compactionRequest).toBeTrue();
});

test("preparation queue and retained history are bounded and cold requests do not wait", async () => {
  for (let index = 0; index < 12; index++) {
    const id = `bounded-${crypto.randomUUID()}`;
    state.rememberResponseState({ input: "history" }, { id, output: [] });
    const body: any = state.expandPreviousResponseInput({ model: "current", previous_response_id: id, input: "fresh" });
    expect(parseRequest(body).context.messages).toHaveLength(2);
    expect((state as any).preparedResponseHistoryStats().pending).toBeLessThanOrEqual(4);
  }
  for (let index = 0; index < 8; index++) await setImmediate();
  expect((state as any).preparedResponseHistoryStats().entries).toBeLessThanOrEqual(8);
  expect((state as any).preparedResponseHistoryStats().retainedBytes).toBeLessThanOrEqual(4 * 1024 * 1024);
});

test("tool lookup preserves first duplicate within an assistant and newest assistant across turns", async () => {
  const history = [
    { type: "function_call", call_id: "duplicate", name: "first", namespace: "old", arguments: "{}" },
    { type: "function_call", call_id: "duplicate", name: "ignored", arguments: "{}" },
    { type: "function_call_output", call_id: "duplicate", output: "first result" },
    { role: "user", content: "next turn" },
    { type: "function_call", call_id: "duplicate", name: "latest", namespace: "fresh", arguments: "{}" },
  ];
  const id = await prepared(history);
  const body: any = state.expandPreviousResponseInput({ model: "model", previous_response_id: id,
    input: [{ type: "function_call_output", call_id: "duplicate", output: "last result" }] });
  const actual = parseRequest(body);
  expect(actual.context.messages.filter(message => message.role === "toolResult")).toMatchObject([
    { toolName: "first", toolNamespace: "old" }, { toolName: "latest", toolNamespace: "fresh" },
  ]);
  expect(withoutTimestamps(actual)).toEqual(withoutTimestamps(parseRequest(structuredClone(body))));
});

test("idle preparation of the next continuation reuses its prepared ancestor", async () => {
  const id = await prepared([{ role: "user", content: "ancestor" }]);
  const body: any = state.expandPreviousResponseInput({ model: "model", previous_response_id: id, input: "new input" });
  const before = (state as any).preparedResponseHistoryStats().hits;
  const next = `prepared-child-${crypto.randomUUID()}`;
  state.rememberResponseState(body, { id: next, output: [{ role: "assistant", content: "new output" }] });
  for (let i = 0; i < 8; i++) await setImmediate();
  expect((state as any).preparedResponseHistoryStats().hits).toBeGreaterThan(before);
  const continuation: any = state.expandPreviousResponseInput({ model: "changed", previous_response_id: next, input: "continue" });
  expect(withoutTimestamps(parseRequest(continuation))).toEqual(withoutTimestamps(parseRequest(structuredClone(continuation))));
});
