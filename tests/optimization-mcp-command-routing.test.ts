import { describe, expect, test } from "bun:test";
import { nativeCommandOptimization } from "../src/adapters/chatgpt-web/mcp-server";

describe("native command optimization routing", () => {
  test("extracts command metadata from direct exec surfaces", () => {
    expect(nativeCommandOptimization(
      { name: "exec_command", namespace: undefined },
      { cmd: "git status --short" },
    )).toEqual({ command: "git status --short" });
    expect(nativeCommandOptimization(
      { name: "shell_command", namespace: undefined },
      { command: "rg TODO src" },
    )).toEqual({ command: "rg TODO src" });
  });

  test("optimizes write_stdin without guessing its original command", () => {
    expect(nativeCommandOptimization(
      { name: "write_stdin", namespace: undefined },
      { session_id: 42 },
    )).toEqual({});
  });

  test("does not treat namespaced or unrelated tools as shell output", () => {
    expect(nativeCommandOptimization(
      { name: "exec_command", namespace: "third_party" },
      { cmd: "git status" },
    )).toBeUndefined();
    expect(nativeCommandOptimization(
      { name: "apply_patch", namespace: undefined },
      { input: "*** Begin Patch" },
    )).toBeUndefined();
    expect(nativeCommandOptimization(
      { name: "exec_command", namespace: undefined },
      { cmd: 123 },
    )).toBeUndefined();
  });
});
