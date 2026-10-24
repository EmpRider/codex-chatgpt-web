import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";

// Opt-in verification against a separately cloned, unmodified 9Router source tree.
// Example: CODEX_9ROUTER_SOURCE=/tmp/9router bun test tests/nine-router-source-contract.test.ts
const root = process.env.CODEX_9ROUTER_SOURCE;
const source = root ? resolve(root) : undefined;

test.skipIf(!source)("pinned unmodified 9Router translates Claude tool history and parallel Responses calls", async () => {
  const sourceRoot = source!;
  expect(existsSync(join(sourceRoot, "open-sse/translator/index.js"))).toBe(true);
  const git = Bun.spawnSync(["git", "rev-parse", "HEAD"], { cwd: sourceRoot });
  expect(git.exitCode).toBe(0);
  expect(git.stdout.toString().trim()).toBe("f39d8f07481ae8518e93175f0ecaaafa61573c6c");

  const mod = await import(pathToFileURL(join(sourceRoot, "open-sse/translator/index.js")).href);
  const fmt = await import(pathToFileURL(join(sourceRoot, "open-sse/translator/formats.js")).href);
  const { translateRequest, translateResponse, initState } = mod;
  const { FORMATS } = fmt;
  const tool = (name: string) => ({ name, description: `Use the originating agent's ${name} capability`,
    input_schema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } });
  const claude = {
    model: "chatgpt-web/gpt-5.6-luna", max_tokens: 2048, stream: true,
    system: "Keep the coding agent's skills and instructions",
    messages: [{ role: "user", content: "Read a file" }], tools: [tool("Read"), tool("Edit")],
  };
  const req = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, claude.model, claude, true);
  expect(req.tools.map((entry: { name: string }) => entry.name)).toEqual(["Read", "Edit"]);
  expect(req.instructions).toContain("skills");

  const readCall = `call_${"A".repeat(32)}`;
  const editCall = `call_${"B".repeat(32)}`;
  const returnTrip = translateRequest(FORMATS.CLAUDE, FORMATS.OPENAI_RESPONSES, claude.model, {
    ...claude,
    messages: [
      { role: "user", content: "Read a file" },
      { role: "assistant", content: [{ type: "tool_use", id: readCall, name: "Read", input: { path: "app.ts" } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: readCall, content: "export {}" }] },
    ],
  }, true);
  expect(returnTrip.input.some((item: { type: string; call_id?: string }) =>
    item.type === "function_call_output" && item.call_id === readCall)).toBe(true);

  const state = initState(FORMATS.OPENAI_RESPONSES);
  const events: Array<Record<string, unknown>> = [
    { type: "response.output_item.added", output_index: 0, item: {
      id: "fc_read", type: "function_call", call_id: readCall, name: "Read", arguments: "", status: "in_progress",
    } },
    { type: "response.output_item.added", output_index: 1, item: {
      id: "fc_edit", type: "function_call", call_id: editCall, name: "Edit", arguments: "", status: "in_progress",
    } },
    { type: "response.function_call_arguments.delta", item_id: "fc_edit", output_index: 1, delta: '{"path":"app.ts"}' },
    { type: "response.function_call_arguments.delta", item_id: "fc_read", output_index: 0, delta: '{"path":"app.ts"}' },
    { type: "response.output_item.done", output_index: 0, item: {
      id: "fc_read", type: "function_call", call_id: readCall, name: "Read", arguments: '{"path":"app.ts"}', status: "completed",
    } },
    { type: "response.output_item.done", output_index: 1, item: {
      id: "fc_edit", type: "function_call", call_id: editCall, name: "Edit", arguments: '{"path":"app.ts"}', status: "completed",
    } },
    { type: "response.completed", response: { usage: { input_tokens: 10, output_tokens: 5 } } },
  ];
  const converted = events.flatMap(item => translateResponse(FORMATS.OPENAI_RESPONSES, FORMATS.OPENAI, item, state));
  const calls = converted.flatMap((chunk: { choices?: Array<{ delta?: { tool_calls?: Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> } }> }) =>
    chunk.choices?.[0]?.delta?.tool_calls ?? []);
  expect(calls.filter((call: { id?: string }) => call.id).map((call: { id?: string; index: number; function?: { name?: string } }) =>
    [call.index, call.id, call.function?.name])).toEqual([[0, readCall, "Read"], [1, editCall, "Edit"]]);
  expect(calls.filter((call: { function?: { arguments?: string } }) => call.function?.arguments)
    .map(call => [call.index, JSON.parse(call.function!.arguments!)]))
    .toEqual([[1, { path: "app.ts" }], [0, { path: "app.ts" }]]);
});
