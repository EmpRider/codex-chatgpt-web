# R9-038 — Build a synthetic browser/MCP/TurnBroker integration harness

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-017](../items/R9-017-expose-agent-neutral-inventory-and-calls-through-existing-mcp-tunnel.md), [R9-023](../items/R9-023-support-multiple-sequential-tool-rounds-without-repeat-sends.md), [R9-024](../items/R9-024-handle-parallel-tool-batches-deterministically.md), [R9-025](../items/R9-025-preserve-tool-errors-output-formats-and-image-evidence.md)

## Detailed description

Build an offline integration harness using actual MCP/TurnBroker contracts and a mocked ChatGPT browser worker. Exercise a realistic multi-round read, patch, test command flow with no real filesystem mutations, while proving one browser conversation persists across tool rounds.

## Implementation steps

1. Use the existing DEV/test abstractions and explicitly mark every synthetic tool receipt as simulated.
2. Exercise direct tool, nested inventory, parallel calls, errors and final answer composition.
3. Assert broker activity fences, MCP invocation timing, browser sends and shutdown cleanup.

## Acceptance criteria

- Three-round tool workflow returns the simulated final answer with no external tool execution.
- No synthetic receipt is misreported as real local side effects.
- Lifecycle tests fail if the browser gets resent or unresolved MCP calls are dropped.

## Required validation and evidence

Run the harness locally and collect deterministic trace/call-count evidence.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
