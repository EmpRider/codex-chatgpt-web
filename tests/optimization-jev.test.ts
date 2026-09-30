import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { jevInternals, optimizeRouteWithJev } from "../src/optimization/jev";
import type { CodexParsedRequest } from "../src/types";

const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
const previousKey = process.env.JEV_API_KEY;
const homes: string[] = [];

afterEach(() => {
  process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  if (previousKey === undefined) delete process.env.JEV_API_KEY;
  else process.env.JEV_API_KEY = previousKey;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function configure() {
  const home = mkdtempSync(join(tmpdir(), "jev-opt-test-"));
  homes.push(home);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  process.env.JEV_API_KEY = "test-key";
  mkdirSync(join(home, "optimization"), { recursive: true });
  writeFileSync(join(home, "optimization", "settings.json"), JSON.stringify({
    jev: { enabled: true, costWeight: 0, decisionTimeoutMs: 4500 },
  }));
}

function parsed(): CodexParsedRequest {
  return {
    modelId: "chatgpt-web/gpt-5.6-sol",
    context: {
      messages: [{ role: "user", content: "Implement the cross-module fix and verify it.", timestamp: 1 }],
      tools: [{ name: "exec_command", description: "run", parameters: {} }],
    },
    stream: true,
    options: { reasoning: "high" },
  };
}

const automatic = {
  browserInteractionMode: "automatic" as const,
  solAvailable: true,
  extraHighAvailable: true,
  proAvailable: true,
};

describe("Jev route optimization", () => {
  test("applies the highest-probability eligible route before normal route resolution", async () => {
    configure();
    const request = parsed();
    const candidates = jevInternals.candidateList(automatic) as any[];
    const selected = candidates.find(candidate =>
      candidate.route.slug === "chatgpt-web/gpt-5.6-pro" && candidate.effort === "max");
    expect(selected).toBeTruthy();
    const probabilities = Object.fromEntries(candidates.map(candidate => [candidate.key, candidate === selected ? 1 : 0]));
    const result = await optimizeRouteWithJev(request, automatic, (async (_url: any, init: any) => {
      expect(init.headers.authorization).toBe("Bearer test-key");
      const body = JSON.parse(init.body);
      expect(body.state.request).toContain("cross-module");
      return new Response(JSON.stringify({
        answers: {
          standalone: { type: "noul", noul: 0 },
          model: { type: "choice", choice: selected.key, confidence: 0.91, probabilities },
        },
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch);
    expect(result.applied).toBe(true);
    expect(request.modelId).toBe("chatgpt-web/gpt-5.6-pro");
    expect(request.options.reasoning).toBe("max");
  });

  test("fails open on an invalid Jev response", async () => {
    configure();
    const request = parsed();
    const before = { model: request.modelId, reasoning: request.options.reasoning };
    const result = await optimizeRouteWithJev(request, automatic, (async () =>
      new Response(JSON.stringify({
        answers: { model: { probabilities: { broken: 1 } } },
      }), { status: 200 })) as typeof fetch);
    expect(result.applied).toBe(false);
    expect(request.modelId).toBe(before.model);
    expect(request.options.reasoning).toBe(before.reasoning);
  });

  test("never reroutes Zero Risk manual mode", async () => {
    configure();
    const request = parsed();
    let called = false;
    const result = await optimizeRouteWithJev(request, {
      browserInteractionMode: "manual",
      solAvailable: false,
      proAvailable: false,
    }, (async () => {
      called = true;
      throw new Error("must not call");
    }) as typeof fetch);
    expect(result.reason).toBe("manual-mode");
    expect(called).toBe(false);
    expect(request.modelId).toBe("chatgpt-web/gpt-5.6-sol");
  });

  test("cost weight can prefer a lower-effort near tie", () => {
    const candidates = jevInternals.candidateList(automatic) as any[];
    const low = candidates.find(candidate => candidate.effort === "low");
    const max = candidates.find(candidate => candidate.effort === "max");
    expect(low).toBeTruthy();
    expect(max).toBeTruthy();
    const subset = [low, max];
    const probabilities = { [low.key]: 0.49, [max.key]: 0.51 };
    expect(jevInternals.choose(subset, probabilities, 0.1, 0).key).toBe(low.key);
  });
});
