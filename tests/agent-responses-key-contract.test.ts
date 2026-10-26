import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// A missing future public interface must fail an assertion, not crash test discovery.
const keyModulePath = "../src/integrations/agent-responses/key-manager";
type KeyModule = {
  loadAgentResponsesKey(configDir?: string): string | undefined;
  provisionAgentResponsesKey(operation: "create" | "rotate", configDir?: string): string;
  disableAgentResponsesKey(configDir?: string): string | undefined;
};
async function keyManager(): Promise<KeyModule> {
  const module = await import(keyModulePath).catch(() => null) as Partial<KeyModule> | null;
  expect(typeof module?.loadAgentResponsesKey).toBe("function");
  expect(typeof module?.provisionAgentResponsesKey).toBe("function");
  expect(typeof module?.disableAgentResponsesKey).toBe("function");
  return module as KeyModule;
}

test("generic bearer provisioning is opt-in, random >=256 bits, private, and rejects silent overwrite", async () => {
  const keys = await keyManager();
  const configDir = mkdtempSync(join(tmpdir(), "agent-responses-key-contract-"));
  try {
    expect(keys.loadAgentResponsesKey(configDir)).toBeUndefined();
    const path = keys.provisionAgentResponsesKey("create", configDir);
    const first = keys.loadAgentResponsesKey(configDir);
    expect(first).toBeDefined();
    expect(Buffer.from(first!, "base64url").byteLength).toBeGreaterThanOrEqual(32);
    expect(readFileSync(path, "utf8")).not.toContain("9router");
    if (process.platform !== "win32") expect(statSync(path).mode & 0o077).toBe(0);
    expect(() => keys.provisionAgentResponsesKey("create", configDir)).toThrow();
    keys.provisionAgentResponsesKey("rotate", configDir);
    const second = keys.loadAgentResponsesKey(configDir);
    expect(second).not.toBe(first);
    expect(Buffer.from(second!, "base64url").byteLength).toBeGreaterThanOrEqual(32);
    expect(keys.disableAgentResponsesKey(configDir)).toBeDefined();
    expect(keys.loadAgentResponsesKey(configDir)).toBeUndefined();
  } finally { rmSync(configDir, { recursive: true, force: true }); }
});
