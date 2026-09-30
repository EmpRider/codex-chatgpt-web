import { existsSync } from "node:fs";
import { loadManagedComponent, loadOptimizationSettings } from "./config";

const SUPPORTED_COMMANDS = [
  "git", "grep", "rg", "ls", "tree", "find", "cat/read",
  "cargo test", "npm/pnpm/bun", "pytest", "go test",
  "docker", "kubectl", "ruff/sqlfluff", "logs",
].join(", ");

function quoteExecutable(path: string): string {
  if (!path.includes(" ") && !path.includes("\t") && !path.includes('"')) return path;
  return `"${path.replaceAll('"', '\\"')}"`;
}

export function rtkToolPolicy(): string[] {
  const settings = loadOptimizationSettings();
  if (!settings.rtk.enabled) return [];
  const record = loadManagedComponent("rtk");
  if (!record?.executable || !existsSync(record.executable)) return [];
  const executable = quoteExecutable(record.executable);
  const prefix = settings.rtk.ultraCompact
    ? `${executable} --ultra-compact`
    : executable;
  return [
    "<optimization_rtk>",
    `RTK executable: ${executable}`,
    "When executing a supported shell command through the existing Codex Native command tool, prefer the launcher-owned RTK wrapper so the command runs normally but returns compact output.",
    `Prefix supported commands with: ${prefix}`,
    `Typical supported command families: ${SUPPORTED_COMMANDS}.`,
    "Examples: '<rtk> git status', '<rtk> rg pattern path', '<rtk> npm test', '<rtk> docker ps'. Preserve the user's requested working directory and command arguments.",
    "For a command without a dedicated RTK wrapper, use '<rtk> summary <cmd> [args...]' only when a heuristic summary is suitable; otherwise run the original command.",
    "Do not run 'rtk init', do not edit Codex/AGENTS/config files, do not modify PATH, and do not install hooks. The launcher already owns RTK.",
    "Use the original command instead of RTK when the user explicitly needs byte-exact/raw command output.",
    "</optimization_rtk>",
  ];
}
