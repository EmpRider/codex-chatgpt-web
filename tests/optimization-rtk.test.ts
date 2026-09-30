import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compressCommandResultWithRtk, rtkFilterForCommand } from "../src/optimization/rtk";
import type { BrokerToolResult } from "../src/adapters/chatgpt-web/turn-broker";

const previousHome = process.env.CODEX_CHATGPT_WEB_HOME;
const homes: string[] = [];

afterEach(() => {
  process.env.CODEX_CHATGPT_WEB_HOME = previousHome;
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});

function configure({ enabled = true, ultraCompact = false } = {}) {
  const home = mkdtempSync(join(tmpdir(), "rtk-opt-test-"));
  homes.push(home);
  process.env.CODEX_CHATGPT_WEB_HOME = home;
  const control = join(home, "optimization");
  const runtime = join(home, "optimization-runtime", "components", "rtk", "1.0.0");
  mkdirSync(control, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  const executable = join(runtime, process.platform === "win32" ? "rtk.exe" : "rtk");
  writeFileSync(executable, "");
  writeFileSync(join(control, "settings.json"), JSON.stringify({
    rtk: { enabled, ultraCompact },
    headroom: { enabled: false },
  }));
  writeFileSync(join(control, "versions.json"), JSON.stringify({
    version: 1,
    components: { rtk: { version: "1.0.0", executable, path: runtime, status: "ready" } },
  }));
}

function result(text: string, extra: Partial<BrokerToolResult> = {}): BrokerToolResult {
  return { content: [{ type: "text", text }], ...extra };
}

describe("RTK native command-result compression", () => {
  test("applies managed RTK pipe output when it is smaller", async () => {
    configure({ ultraCompact: true });
    const raw = "verbose line\n".repeat(100);
    let invocation: { executable: string; input: string; ultra: boolean; filter?: string } | undefined;
    const output = await compressCommandResultWithRtk(result(raw), async (executable, input, ultra, filter) => {
      invocation = { executable, input, ultra, filter };
      return { output: "10 lines summarized\n", stderr: "" };
    });
    expect(invocation?.input).toBe(raw);
    expect(invocation?.ultra).toBe(true);
    expect(invocation?.filter).toBeUndefined();
    expect((output.content[0] as any).text).toBe("10 lines summarized\n");
  });

  test("selects exact RTK filters for recognized native commands", async () => {
    configure();
    const raw = "commit abc123\n".repeat(100);
    let filter: string | undefined;
    await compressCommandResultWithRtk(
      result(raw),
      async (_executable, _input, _ultra, selected) => {
        filter = selected;
        return { output: "compact\n", stderr: "" };
      },
      "git log --oneline -20",
    );
    expect(filter).toBe("git-log");
    expect(rtkFilterForCommand("git status --short")).toBe("git-status");
    expect(rtkFilterForCommand("git diff --stat")).toBe("git-diff");
    expect(rtkFilterForCommand("rg TODO src")).toBe("rg");
    expect(rtkFilterForCommand("python -m pytest -q")).toBe("pytest");
    expect(rtkFilterForCommand("cargo test --all")).toBe("cargo-test");
    expect(rtkFilterForCommand("mvn test")).toBeUndefined();
  });

  test("recognizes common shell wrappers without guessing arbitrary commands", () => {
    expect(rtkFilterForCommand('cmd /c "git status --short"')).toBe("git-status");
    expect(rtkFilterForCommand("bash -lc 'git diff --stat'")).toBe("git-diff");
    expect(rtkFilterForCommand("powershell.exe -NoProfile -Command rg TODO src")).toBe("rg");
    expect(rtkFilterForCommand("echo git status")).toBeUndefined();
  });

  test("keeps raw output when RTK fails or does not reduce bytes", async () => {
    configure();
    const raw = "important evidence\n".repeat(100);
    const failed = await compressCommandResultWithRtk(result(raw), async () => {
      throw new Error("rtk unavailable");
    });
    expect((failed.content[0] as any).text).toBe(raw);
    const larger = await compressCommandResultWithRtk(result(raw), async () => ({
      output: raw + "extra",
      stderr: "",
    }));
    expect((larger.content[0] as any).text).toBe(raw);
  });

  test("never filters errors or structured tool results", async () => {
    configure();
    let calls = 0;
    const runner = async () => {
      calls += 1;
      return { output: "compressed", stderr: "" };
    };
    const raw = "diagnostic\n".repeat(100);
    const error = await compressCommandResultWithRtk(result(raw, { isError: true }), runner);
    const structured = await compressCommandResultWithRtk(result(raw, { structuredContent: { raw } }), runner);
    expect((error.content[0] as any).text).toBe(raw);
    expect((structured.content[0] as any).text).toBe(raw);
    expect(calls).toBe(0);
  });

  test("disabled RTK leaves command output untouched", async () => {
    configure({ enabled: false });
    const raw = "verbose\n".repeat(100);
    let called = false;
    const output = await compressCommandResultWithRtk(result(raw), async () => {
      called = true;
      return { output: "compressed", stderr: "" };
    });
    expect(called).toBe(false);
    expect((output.content[0] as any).text).toBe(raw);
  });
});
