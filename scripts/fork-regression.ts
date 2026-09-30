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
  "tests/prompt-contract.test.ts",
  // Launcher-managed optimization stack: routing, policies, context/tool compression and fail-open behavior.
  "tests/optimization-config.test.ts",
  "tests/optimization-headroom.test.ts",
  "tests/optimization-instructions.test.ts",
  "tests/optimization-jev.test.ts",
  "tests/optimization-mcp-command-routing.test.ts",
  "tests/optimization-rtk.test.ts",
  // The full chatgpt-web-harness suite runs in bun run verify immediately after this gate.
  // Do not duplicate the entire harness here: standalone selection can retain Windows-only
  // broker handles longer than the focused tests below need, while adding no release coverage.
];

const launcherRegressionFiles = [
  // Five-tab safety limit, retained tabs, sign-in redirects, manual/automatic ownership.
  "tests/browser-host.test.cjs",
  // Custom connector names and runtime configuration preservation.
  "tests/runtime-host.test.cjs",
  // Renderer wiring for settings and connector-name updates.
  "tests/renderer-wiring.test.cjs",
  "tests/localization.test.cjs",
  "tests/windows-trust.test.cjs",
  // App-owned optimizer provisioning, updates, secrets, runtime safety and self-healing.
  "tests/optimization-controller-security.test.cjs",
  "tests/optimization-headroom-manager.test.cjs",
  "tests/optimization-jev-manager.test.cjs",
  "tests/optimization-managed-tools.test.cjs",
  "tests/optimization-provisioner.test.cjs",
  "tests/optimization-rtk-manager.test.cjs",
  "tests/optimization-runtime-paths.test.cjs",
  "tests/optimization-secrets.test.cjs",
];

const REGRESSION_COMMAND_TIMEOUT_MS = 5 * 60_000;

async function run(command: string, args: string[], cwd = root): Promise<void> {
  console.log(`\n[regression] ${command} ${args.join(" ")}`);
  const child = Bun.spawn([command, ...args], {
    cwd,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    console.error(
      `[regression] timed out after ${REGRESSION_COMMAND_TIMEOUT_MS}ms: ${command} ${args.join(" ")}`,
    );
    child.kill();
  }, REGRESSION_COMMAND_TIMEOUT_MS);
  try {
    const exitCode = await child.exited;
    if (timedOut) {
      throw new Error(
        `Fork regression command timed out: ${command} ${args.join(" ")}`,
      );
    }
    if (exitCode !== 0) {
      throw new Error(`Fork regression command failed (${exitCode}): ${command} ${args.join(" ")}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

console.log("Fork regression gate: validating EmpRider custom behavior before general verification.");

await run(process.execPath, ["test", ...rootRegressionFiles]);
// Run the intentionally timer-heavy long-turn stress suite in isolation so it cannot distort the
// tight timing assertions in retained-compaction and other normal regression files.
await run(process.execPath, ["test", "regression/long-turn-lifecycle.test.ts"]);
await run("node", ["--test", ...launcherRegressionFiles], resolve(root, "launcher"));

console.log("\nFork regression gate passed.");
