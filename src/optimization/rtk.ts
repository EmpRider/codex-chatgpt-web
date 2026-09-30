import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { BrokerToolResult } from "../adapters/chatgpt-web/turn-broker";
import { loadManagedComponent, loadOptimizationSettings } from "./config";

const RTK_MAX_INPUT_BYTES = 10 * 1024 * 1024;
const RTK_MIN_INPUT_CHARS = 256;
const RTK_TIMEOUT_MS = 5_000;
const RTK_MAX_CAPTURE_CHARS = 12 * 1024 * 1024;

interface TextBlock {
  type: "text";
  text: string;
  [key: string]: unknown;
}

export interface RtkFilterResult {
  output: string;
  stderr: string;
}

export type RtkFilterRunner = (
  executable: string,
  input: string,
  ultraCompact: boolean,
  filterName?: string,
) => Promise<RtkFilterResult>;

const RTK_FILTER_PATTERNS: Array<[RegExp, string]> = [
  [/^git\s+(?:-[^\s]+\s+)*status\b/i, "git-status"],
  [/^git\s+(?:-[^\s]+\s+)*log\b/i, "git-log"],
  [/^git\s+(?:-[^\s]+\s+)*diff\b/i, "git-diff"],
  [/^(?:rg|ripgrep)\b/i, "rg"],
  [/^grep\b/i, "grep"],
  [/^fd\b/i, "fd"],
  [/^find\b/i, "find"],
  [/^journalctl\b/i, "log"],
  [/^docker\s+logs\b/i, "log"],
  [/^kubectl\s+logs\b/i, "log"],
  [/^(?:python(?:3)?\s+-m\s+)?pytest\b/i, "pytest"],
  [/^cargo\s+test\b/i, "cargo-test"],
  [/^go\s+test\b/i, "go-test"],
  [/^go\s+build\b/i, "go-build"],
  [/^ctest\b/i, "ctest"],
  [/^(?:npx\s+|bunx\s+|pnpm\s+exec\s+)?tsc\b/i, "tsc"],
  [/^(?:npx\s+|bunx\s+|pnpm\s+exec\s+)?vitest\b/i, "vitest"],
  [/^mypy\b/i, "mypy"],
  [/^ruff\s+check\b/i, "ruff-check"],
  [/^ruff\s+format\b/i, "ruff-format"],
  [/^(?:npx\s+|bunx\s+|pnpm\s+exec\s+)?prettier\b/i, "prettier"],
  [/^(?:php\s+)?phpunit\b/i, "phpunit"],
  [/^phpstan\b/i, "phpstan"],
];

export function rtkFilterForCommand(command?: string): string | undefined {
  if (!command) return undefined;
  const normalized = command.trim()
    .replace(/^(?:cmd(?:\.exe)?\s+\/c\s+|powershell(?:\.exe)?\s+(?:-[^\s]+\s+)*-Command\s+)/i, "")
    .replace(/^(?:bash|sh|zsh)\s+-lc\s+/i, "")
    .replace(/^["']|["']$/g, "")
    .trim();
  for (const [pattern, filter] of RTK_FILTER_PATTERNS) {
    if (pattern.test(normalized)) return filter;
  }
  return undefined;
}

function singleTextBlock(result: BrokerToolResult): TextBlock | undefined {
  if (!Array.isArray(result.content) || result.content.length !== 1) return undefined;
  const block = result.content[0];
  if (!block || typeof block !== "object" || Array.isArray(block)) return undefined;
  const candidate = block as Record<string, unknown>;
  return candidate.type === "text" && typeof candidate.text === "string"
    ? candidate as TextBlock
    : undefined;
}

export function runRtkPipe(
  executable: string,
  input: string,
  ultraCompact: boolean,
  filterName?: string,
): Promise<RtkFilterResult> {
  return new Promise((resolve, reject) => {
    const args = [
      ...(ultraCompact ? ["--ultra-compact"] : []),
      "pipe",
      ...(filterName ? ["--filter", filterName] : []),
    ];
    const child = spawn(executable, args, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { child.kill("SIGKILL"); } catch {}
      reject(new Error("RTK filter timed out"));
    }, RTK_TIMEOUT_MS);
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ output: stdout, stderr });
    };
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString("utf8");
      if (next.length > RTK_MAX_CAPTURE_CHARS) {
        throw new Error("RTK filter output exceeded size limit");
      }
      return next;
    };
    child.stdout.on("data", chunk => {
      try { stdout = append(stdout, chunk); } catch (error) {
        try { child.kill("SIGKILL"); } catch {}
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.stderr.on("data", chunk => {
      try { stderr = append(stderr, chunk); } catch (error) {
        try { child.kill("SIGKILL"); } catch {}
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
    child.once("error", error => finish(error));
    child.once("exit", code => {
      if (code !== 0) {
        finish(new Error(`RTK filter exited ${code}: ${stderr.trim().slice(-1000)}`));
        return;
      }
      finish();
    });
    child.stdin.once("error", error => finish(error));
    child.stdin.end(input);
  });
}

export async function compressCommandResultWithRtk(
  result: BrokerToolResult,
  runner: RtkFilterRunner = runRtkPipe,
  command?: string,
): Promise<BrokerToolResult> {
  const settings = loadOptimizationSettings();
  if (!settings.rtk.enabled || result.isError || result.structuredContent !== undefined) return result;

  const block = singleTextBlock(result);
  if (!block) return result;
  const raw = block.text;
  const bytes = Buffer.byteLength(raw);
  if (raw.length < RTK_MIN_INPUT_CHARS || bytes > RTK_MAX_INPUT_BYTES) return result;

  const component = loadManagedComponent("rtk");
  if (!component?.executable || !existsSync(component.executable)) return result;

  try {
    const filtered = await runner(
      component.executable,
      raw,
      settings.rtk.ultraCompact,
      rtkFilterForCommand(command),
    );
    // RTK's own pipe mode is fail-open via never_worse. Keep the same invariant at our boundary
    // in case an upstream version changes formatting or emits diagnostic text to stdout.
    if (!filtered.output || Buffer.byteLength(filtered.output) >= bytes) return result;
    return {
      ...result,
      content: [{ ...block, text: filtered.output }],
    };
  } catch {
    return result;
  }
}

export const rtkInternals = {
  RTK_MAX_INPUT_BYTES,
  RTK_MIN_INPUT_CHARS,
  RTK_FILTER_PATTERNS,
  singleTextBlock,
};
