#!/usr/bin/env node
/**
 * Intentionally conservative upstream-overlap sentinel. Run after every upstream
 * pull/rebase and before a fork release; this does NOT replace a real merge test.
 * Baseline is the fork's planning-only commit, before runtime implementation.
 */
import { execFileSync } from "node:child_process";

const defaultBaseline = "9dd77354e446491d0328602363e70d349859ae02";
const inheritedTouchpoints = new Set([
  "src/server.ts",
  "src/cli.ts",
  "src/adapters/chatgpt-web/turn-broker.ts",
  "src/adapters/chatgpt-web/mcp-server.ts",
]);

export function classifyProviderChanges(paths) {
  const untouched = [];
  const namespaced = [];
  const inherited = [];
  const unexpected = [];
  for (const path of paths) {
    if (!path || !path.startsWith("src/") && !path.startsWith("launcher/")) {
      untouched.push(path); continue;
    }
    if (path.startsWith("src/integrations/nine-router/")) namespaced.push(path);
    else if (inheritedTouchpoints.has(path)) inherited.push(path);
    else unexpected.push(path);
  }
  return { namespaced, inherited, unexpected, untouched };
}

export function auditWorkingTree(baseline = defaultBaseline) {
  const git = (...args) => execFileSync("git", args, { encoding: "utf8" }).trim();
  // Existing modules changed since the planning commit (including unstaged edits).
  const tracked = git("diff", "--name-only", baseline, "--", "src", "launcher").split("\n").filter(Boolean);
  // New source files are intentionally not required to be staged for this guard.
  const newFiles = git("ls-files", "--others", "--exclude-standard", "--", "src", "launcher")
    .split("\n").filter(Boolean);
  return classifyProviderChanges([...new Set([...tracked, ...newFiles])]);
}

if (process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href) {
  try {
    const result = auditWorkingTree(process.argv[2]);
    process.stdout.write(`9Router-owned files: ${result.namespaced.length}\n`);
    process.stdout.write(`Expected upstream touchpoints (${result.inherited.length}):\n${result.inherited.map(path => `  ${path}`).join("\n")}\n`);
    if (result.unexpected.length) {
      process.stderr.write(`UNEXPECTED source/launcher drift; inspect before upstream merge:\n${result.unexpected.join("\n")}\n`);
      process.exitCode = 1;
    } else process.stdout.write("PASS: no unexpected inherited modules were changed. Review the listed touchpoints during each upstream sync.\n");
  } catch (error) {
    process.stderr.write(`Cannot inspect baseline. Fetch the history or supply a known planning base SHA. (${error instanceof Error ? error.name : "Error"})\n`);
    process.exitCode = 2;
  }
}
