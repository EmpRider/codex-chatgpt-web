import { expect, test } from "bun:test";
import * as bridge from "../src/adapters/chatgpt-web/mcp-server";

test("long terminal observation yields within the MCP budget without changing input", () => {
  const prepare = (bridge as any).nativeStdinPollArguments;
  expect(typeof prepare).toBe("function");
  const input = { session_id: 42, chars: "y\n", yield_time_ms: 300_000, max_output_tokens: 2000 };
  expect(prepare(input)).toEqual({ ...input, yield_time_ms: 30_000 });
  expect(input.yield_time_ms).toBe(300_000);
  expect(prepare({ session_id: 42, yield_time_ms: 5000 })).toEqual({ session_id: 42, yield_time_ms: 5000 });
  expect(prepare({ session_id: 42 })).toEqual({ session_id: 42 });
});
