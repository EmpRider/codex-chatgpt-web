import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { provisionAgentResponsesKey } from "../src/integrations/agent-responses/key-manager";

for (const provisioned of [false, true]) {
  test(`disabled-key fixture ignores ${provisioned ? "provisioned" : "empty"} parent app home`, () => {
    const home = mkdtempSync(join(tmpdir(), "agent-responses-parent-home-"));
    try {
      if (provisioned) provisionAgentResponsesKey("create", home);
      const result = Bun.spawnSync([
        process.execPath, "test", "./tests/agent-responses-gateway-contract.test.ts",
        "--test-name-pattern", "generic /v1/models stays disabled", "--timeout", "15000",
      ], {
        cwd: resolve(import.meta.dir, ".."),
        env: { ...process.env, CODEX_CHATGPT_WEB_HOME: home },
        stdout: "pipe",
        stderr: "pipe",
        timeout: 20_000,
      });
      expect(result.exitCode, result.stdout.toString() + result.stderr.toString()).toBe(0);
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  }, 25_000);
}
