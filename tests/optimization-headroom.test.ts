import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  compressCommandResultWithHeadroom,
  compressParsedContextWithHeadroom,
  headroomEligibleMessages,
} from "../src/optimization/headroom";
import { effectiveHeadroomPort, loadOptimizationSettings } from "../src/optimization/config";
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
    }) as unknown as typeof fetch);
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
    }) as unknown as typeof fetch);
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
      new Response(JSON.stringify({ messages: [] }), { status: 200 })) as unknown as typeof fetch);
    expect(result.applied).toBe(false);
    expect((request.context.messages[0] as any).content).toBe(original);
  });
});

describe("Headroom live command-result compression", () => {
  test("an unavailable service is bypassed during cooldown and retried after recovery", async () => {
    configureHeadroom({ minTokens: 50 });
    const source = { content: [{ type: "text", text: "command output ".repeat(1000) }] };
    let calls = 0;
    let now = Date.now();
    const originalNow = Date.now;
    Date.now = () => now;
    const fetchImpl = (async () => {
      calls++;
      if (calls === 1) throw new Error("offline");
      return new Response(JSON.stringify({ messages: [{ role: "assistant", content: "recovered" }] }));
    }) as unknown as typeof fetch;
    try {
      expect(await compressCommandResultWithHeadroom(source, fetchImpl)).toBe(source);
      expect(await compressCommandResultWithHeadroom(source, fetchImpl)).toBe(source);
      expect(calls).toBe(1);
      now += 30_001;
      expect((await compressCommandResultWithHeadroom(source, fetchImpl)).content).toEqual([{ type: "text", text: "recovered" }]);
      expect(calls).toBe(2);
    } finally { Date.now = originalNow; }
  });

  test("compresses a large plain-text command result without changing its MCP shape", async () => {
    configureHeadroom({ minTokens: 50 });
    const raw = "repeated command output ".repeat(1000);
    const source = { content: [{ type: "text", text: raw }] };
    const result = await compressCommandResultWithHeadroom(source, (async (_url: any, init: any) => {
      const body = JSON.parse(init.body);
      expect(body.messages).toEqual([{ role: "assistant", content: raw }]);
      return new Response(JSON.stringify({
        messages: [{ role: "assistant", content: "compressed command evidence" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as unknown as typeof fetch);
    expect(result.content).toEqual([{ type: "text", text: "compressed command evidence" }]);
  });

  test("fails open for command errors and unavailable service", async () => {
    configureHeadroom({ minTokens: 50 });
    const raw = "diagnostic ".repeat(1000);
    let called = false;
    const errorResult = await compressCommandResultWithHeadroom({
      content: [{ type: "text", text: raw }],
      isError: true,
    }, (async () => {
      called = true;
      throw new Error("must not call");
    }) as unknown as typeof fetch);
    expect(called).toBe(false);
    expect((errorResult.content[0] as any).text).toBe(raw);

    const unavailable = await compressCommandResultWithHeadroom({
      content: [{ type: "text", text: raw }],
    }, (async () => {
      throw new Error("offline");
    }) as unknown as typeof fetch);
    expect((unavailable.content[0] as any).text).toBe(raw);
  });
});

describe("Headroom runtime port selection", () => {
  test("uses the launcher-published effective port when the preferred port is occupied", async () => {
    configureHeadroom({ port: 8787, minTokens: 50 });
    const home = process.env.CODEX_CHATGPT_WEB_HOME!;
    writeFileSync(join(home, "optimization", "runtime.json"), JSON.stringify({
      version: 1,
      headroom: {
        running: true,
        ready: true,
        port: 8788,
        preferredPort: 8787,
        portConflict: true,
      },
    }));

    expect(effectiveHeadroomPort(loadOptimizationSettings())).toBe(8788);

    const raw = "repeated runtime output ".repeat(1000);
    let calledUrl = "";
    const result = await compressCommandResultWithHeadroom({
      content: [{ type: "text", text: raw }],
    }, (async (url: any) => {
      calledUrl = String(url);
      return new Response(JSON.stringify({
        messages: [{ role: "assistant", content: "compressed" }],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);

    expect(calledUrl).toBe("http://127.0.0.1:8788/v1/compress");
    expect((result.content[0] as any).text).toBe("compressed");
  });

  test("falls back to the preferred port when no ready runtime state exists", () => {
    configureHeadroom({ port: 8799 });
    expect(effectiveHeadroomPort(loadOptimizationSettings())).toBe(8799);
  });
});
