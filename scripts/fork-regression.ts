import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");

const rootRegressionFiles = [
  // Chat Clean, updated ChatGPT DOMs, browser capacity/stall recovery, final-answer recovery.
  "tests/browser-worker-contract.test.ts",
  // Large-prompt MCP transport, read-only context access, five-chunk batching.
  "tests/mcp-context-read-safety.test.ts",
  // Structured/retained compaction, heartbeat + TTL renewal, handoff recovery.
  "tests/retained-compaction.test.ts",
  // Capacity retry turn_id rollover and trusted Codex environment recovery.
  "tests/environment.test.ts",
  // Launcher control channel, cancellation, retained conversations, auth-required propagation.
  "tests/launcher-browser-host.test.ts",
  // Broker lifecycle, physical cleanup, capacity and completion semantics.
  "tests/turn-broker-lifecycle.test.ts",
  // Current/legacy ChatGPT response layouts and final-answer extraction.
  "tests/browser-response-dom.test.ts",
  "tests/chatgpt-session.test.ts",
  // End-to-end adapter/MCP contracts and retained-turn behavior.
  "tests/chatgpt-web-harness.test.ts",
];

const launcherRegressionFiles = [
  // Five-tab safety limit, retained tabs, sign-in redirects, manual/automatic ownership.
  "tests/browser-host.test.cjs",
  // Custom connector names and runtime configuration preservation.
  "tests/runtime-host.test.cjs",
  // Renderer wiring for settings and connector-name updates.
  "tests/renderer-wiring.test.cjs",
];

async function run(command: string, args: string[], cwd = root): Promise<void> {
  console.log(`\n[regression] ${command} ${args.join(" ")}`);
  const child = Bun.spawn([command, ...args], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  const exitCode = await child.exited;
  if (exitCode !== 0) {
    throw new Error(`Fork regression command failed (${exitCode}): ${command} ${args.join(" ")}`);
  }
}

console.log("Fork regression gate: validating EmpRider custom behavior before general verification.");

await run(process.execPath, ["test", ...rootRegressionFiles]);
await run("node", ["--test", ...launcherRegressionFiles], resolve(root, "launcher"));

console.log("\nFork regression gate passed.");
