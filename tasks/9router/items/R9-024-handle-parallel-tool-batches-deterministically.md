# R9-024 — Handle parallel tool batches deterministically

- **Epic:** [R9-E05 — Round-trip tool calls and browser continuation](../epics/R9-E05-tool-loop.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md), [R9-023](../items/R9-023-support-multiple-sequential-tool-rounds-without-repeat-sends.md)

## Detailed description

Support a ChatGPT response that requests several independent tools concurrently. Preserve all call IDs, accept valid out-of-order result delivery according to the chosen contract, and only resume the model after the required batch is resolved or explicitly failed.

## Implementation steps

1. Define stable batching, pending counts and timeouts for multiple outstanding functions.
2. Validate missing/extra/duplicate tool results without partial silent completion.
3. Keep session isolation when two parallel agents use identical public tool names.

## Acceptance criteria

- A two-tool batch returns two tool_use calls with distinct IDs.
- Results delivered out of order still bind to the right tool request.
- Incomplete batches cannot cause fabricated success or leaked pending calls.

## Required validation and evidence

Run deterministic parallel fixture tests with swapped response order and one missing result.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
