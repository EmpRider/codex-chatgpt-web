import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { optimizationPolicyForRequest } from "../src/optimization/instructions";
import type { CodexParsedRequest } from "../src/types";

const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
const homes: string[] = [];

afterEach(() => {
  process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function configure(optimization: Record<string, unknown>) {
  const home = mkdtempSync(join(tmpdir(), "policy-opt-test-"));
  homes.push(home);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  mkdirSync(join(home, "optimization"), { recursive: true });
  writeFileSync(join(home, "optimization", "settings.json"), JSON.stringify(optimization));
}

function request(subagent = false): CodexParsedRequest {
  return {
    modelId: "gpt-5.6-sol",
    stream: true,
    options: {},
    context: {
      messages: [{ role: "user", content: "Implement the fix.", timestamp: 1 }],
    },
    ...(subagent ? {
      _rawBody: {
        client_metadata: {
          "x-codex-turn-metadata": JSON.stringify({
            thread_id: "child-thread",
            turn_id: "turn-1",
            parent_thread_id: "parent-thread",
            agent_name: "/root/worker",
            subagent_kind: "thread_spawn",
          }),
        },
      },
    } : {}),
  };
}

describe("optimization instruction policy", () => {
  test("Ponytail is omitted for subagents when disabled there", () => {
    configure({
      adhd: { enabled: false },
      caveman: { enabled: false },
      ponytail: { enabled: true, level: "full", applyToSubagents: false },
      rtk: { enabled: false },
    });
    expect(optimizationPolicyForRequest(request(true)).join("\n")).not.toContain("optimization_ponytail");
    expect(optimizationPolicyForRequest(request(false)).join("\n")).toContain("optimization_ponytail");
  });

  test("Ponytail is included for subagents when explicitly enabled", () => {
    configure({
      adhd: { enabled: false },
      caveman: { enabled: false },
      ponytail: { enabled: true, level: "full", applyToSubagents: true },
      rtk: { enabled: false },
    });
    expect(optimizationPolicyForRequest(request(true)).join("\n")).toContain("optimization_ponytail");
  });
});
