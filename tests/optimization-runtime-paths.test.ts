import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  isManagedRuntimePath,
  loadManagedComponent,
  optimizationRuntimeRoot,
} from "../src/optimization/config";

const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
const homes: string[] = [];

afterEach(() => {
  process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function home() {
  const root = mkdtempSync(join(tmpdir(), "optimization-path-test-"));
  homes.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  mkdirSync(join(root, "optimization"), { recursive: true });
  return root;
}

describe("managed optimization runtime containment", () => {
  test("accepts only absolute paths inside optimization-runtime", () => {
    const root = home();
    const runtime = join(root, "optimization-runtime");
    expect(optimizationRuntimeRoot()).toBe(runtime);
    expect(isManagedRuntimePath(join(runtime, "components", "rtk", "1"))).toBe(true);
    expect(isManagedRuntimePath(root)).toBe(false);
    expect(isManagedRuntimePath(resolve(root, "..", "outside"))).toBe(false);
    expect(isManagedRuntimePath("relative/path")).toBe(false);
  });

  test("rejects tampered component paths and executables", () => {
    const root = home();
    const runtime = join(root, "optimization-runtime", "components", "rtk", "1");
    mkdirSync(runtime, { recursive: true });
    const executable = join(runtime, process.platform === "win32" ? "rtk.exe" : "rtk");
    writeFileSync(executable, "");

    writeFileSync(join(root, "optimization", "versions.json"), JSON.stringify({
      components: { rtk: { version: "1", path: runtime, executable, status: "ready" } },
    }));
    expect(loadManagedComponent("rtk")?.path).toBe(runtime);

    writeFileSync(join(root, "optimization", "versions.json"), JSON.stringify({
      components: { rtk: { version: "1", path: root, executable, status: "ready" } },
    }));
    expect(loadManagedComponent("rtk")).toBeUndefined();

    writeFileSync(join(root, "optimization", "versions.json"), JSON.stringify({
      components: { rtk: { version: "1", path: runtime, executable: resolve(root, "..", "evil"), status: "ready" } },
    }));
    expect(loadManagedComponent("rtk")).toBeUndefined();
  });
});
