import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compressParsedContextWithHeadroom,
  headroomEligibleMessages,
} from "../src/optimization/headroom";
import type { CodexParsedRequest } from "../src/types";

const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
const homes: string[] = [];

afterEach(() => {
  process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function parsed(messages: any[]): CodexParsedRequest {
  return {
    modelId: "gpt-5.6-sol",
    context: { messages },
    stream: true,
    options: {},
  };
}

function configureHeadroom(overrides: Record<string, unknown> = {}) {
  const home = mkdtempSync(join(tmpdir(), "headroom-opt-test-"));
  homes.push(home);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  const dir = join(home, "optimization");
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "settings.json"), JSON.stringify({
    headroom: {
      enabled: true,
      minTokens: 50,
      protectRecentTurns: 1,
      port: 8787,
      codeEnabled: true,
      mlEnabled: false,
      ...overrides,
    },
  }));
}

describe("Headroom context optimization", () => {
  test("protects user/developer authority and recent turns", () => {
    const request = parsed([
      { role: "user", content: "old request", timestamp: 1 },
      { role: "toolResult", toolCallId: "old-tool", toolName: "exec", content: "old ".repeat(1000), isError: false, timestamp: 2 },
      { role: "assistant", content: [{ type: "text", text: "old assistant ".repeat(500) }], timestamp: 3 },
      { role: "user", content: "current request", timestamp: 4 },
      { role: "toolResult", toolCallId: "new-tool", toolName: "exec", content: "new ".repeat(1000), isError: false, timestamp: 5 },
    ]);
    const eligible = headroomEligibleMessages(request, 50, 1);
    expect(eligible.map(item => item.index)).toEqual([1, 2]);
  });

  test("applies marker-free compression only when response structure is preserved", async () => {
    configureHeadroom({ protectRecentTurns: 0 });
    const request = parsed([
      { role: "toolResult", toolCallId: "tool-1", toolName: "exec", content: "noise ".repeat(1000), isError: false, timestamp: 1 },
    ]);
    const result = await compressParsedContextWithHeadroom(request, (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.config.mode).toBe("lossy_inline");
      expect(body.messages[0].tool_call_id).toBe("tool-1");
      return new Response(JSON.stringify({
        messages: [{ role: "tool", tool_call_id: "tool-1", content: "compressed" }],
        tokens_before: 1500,
        tokens_after: 20,
        tokens_saved: 1480,
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);
    expect(result.applied).toBe(true);
    expect((request.context.messages[0] as any).content).toBe("compressed");
    expect(result.tokensSaved).toBe(1480);
  });

  test("fails open when Headroom is unavailable", async () => {
    configureHeadroom({ protectRecentTurns: 0 });
    const original = "important ".repeat(1000);
    const request = parsed([
      { role: "toolResult", toolCallId: "tool-1", toolName: "exec", content: original, isError: false, timestamp: 1 },
    ]);
    const result = await compressParsedContextWithHeadroom(request, (async () => {
      throw new Error("offline");
    }) as typeof fetch);
    expect(result.applied).toBe(false);
    expect((request.context.messages[0] as any).content).toBe(original);
  });

  test("rejects structural changes and preserves original content", async () => {
    configureHeadroom({ protectRecentTurns: 0 });
    const original = "important ".repeat(1000);
    const request = parsed([
      { role: "toolResult", toolCallId: "tool-1", toolName: "exec", content: original, isError: false, timestamp: 1 },
    ]);
    const result = await compressParsedContextWithHeadroom(request, (async () =>
      new Response(JSON.stringify({ messages: [] }), { status: 200 })) as typeof fetch);
    expect(result.applied).toBe(false);
    expect((request.context.messages[0] as any).content).toBe(original);
  });
});
