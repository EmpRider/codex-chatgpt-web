import { existsSync } from "node:fs";
import { loadManagedComponent, loadOptimizationSettings } from "./config";

const SUPPORTED_COMMANDS = [
  "git", "gh", "grep", "rg", "ls", "tree", "find", "cat/read",
  "npm/pnpm/bun", "pytest/test runners", "mvn/mvnd/gradle",
  "docker", "kubectl", "logs", "lint/build/typecheck",
].join(", ");

function quoteExecutable(path: string): string {
  return path.includes(" ") || path.includes("\t") ? JSON.stringify(path) : path;
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
    "Examples: '<rtk> git status', '<rtk> rg pattern path', '<rtk> mvn test', '<rtk> docker ps'. Preserve the user's requested working directory and command arguments.",
    "Do not run 'rtk init', do not edit Codex/AGENTS/config files, do not modify PATH, and do not install hooks. The launcher already owns RTK.",
    "Use the original command instead of RTK when the user explicitly needs byte-exact/raw command output or when RTK does not support the command.",
    "</optimization_rtk>",
  ];
}
