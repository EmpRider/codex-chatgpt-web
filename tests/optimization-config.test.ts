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
  const root = mkdtempSync(join(tmpdir(), "optimization-config-test-"));
  homes.push(root);
  process.env.CODEX_CHATGPT_WEB_HOME = root;
  mkdirSync(join(root, "optimization"), { recursive: true });
  mkdirSync(join(root, "optimization-runtime", "components"), { recursive: true });
  return root;
}

describe("managed optimization runtime paths", () => {
  test("accepts only absolute paths inside optimization-runtime", () => {
    const root = home();
    const runtime = optimizationRuntimeRoot();
    expect(runtime).toBe(join(root, "optimization-runtime"));
    expect(isManagedRuntimePath(join(runtime, "components", "rtk", "1", "rtk"))).toBe(true);
    expect(isManagedRuntimePath(runtime)).toBe(true);
    expect(isManagedRuntimePath(join(root, "optimization", "settings.json"))).toBe(false);
    expect(isManagedRuntimePath(resolve(root, "..", "outside"))).toBe(false);
    expect(isManagedRuntimePath("relative/path")).toBe(false);
  });

  test("rejects tampered component records that escape the runtime root", () => {
    const root = home();
    writeFileSync(join(root, "optimization", "versions.json"), JSON.stringify({
      version: 1,
      components: {
        rtk: {
          version: "1.0.0",
          path: resolve(root, "..", "outside"),
          executable: resolve(root, "..", "outside", "rtk"),
          status: "ready",
        },
      },
    }));
    expect(loadManagedComponent("rtk")).toBeUndefined();
  });

  test("rejects managed records that are not ready yet", () => {
    const root = home();
    const component = join(root, "optimization-runtime", "components", "rtk", "1.0.0");
    const executable = join(component, process.platform === "win32" ? "rtk.exe" : "rtk");
    mkdirSync(component, { recursive: true });
    writeFileSync(executable, "");
    writeFileSync(join(root, "optimization", "versions.json"), JSON.stringify({
      version: 1,
      components: {
        rtk: { version: "1.0.0", path: component, executable, status: "repair-needed" },
      },
    }));
    expect(loadManagedComponent("rtk")).toBeUndefined();
  });

  test("accepts app-owned component and executable paths", () => {
    const root = home();
    const component = join(root, "optimization-runtime", "components", "rtk", "1.0.0");
    const executable = join(component, process.platform === "win32" ? "rtk.exe" : "rtk");
    mkdirSync(component, { recursive: true });
    writeFileSync(executable, "");
    writeFileSync(join(root, "optimization", "versions.json"), JSON.stringify({
      version: 1,
      components: {
        rtk: { version: "1.0.0", path: component, executable, status: "ready" },
      },
    }));
    expect(loadManagedComponent("rtk")?.executable).toBe(executable);
  });
});
