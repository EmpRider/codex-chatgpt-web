# R9-026 — Define continuation and compaction state after failures or restart

- **Epic:** [R9-E05 — Round-trip tool calls and browser continuation](../epics/R9-E05-tool-loop.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-014](../items/R9-014-define-deterministic-external-turn-and-browser-session-ownership.md), [R9-023](../items/R9-023-support-multiple-sequential-tool-rounds-without-repeat-sends.md)

## Detailed description

Specify and implement safe behavior when the daemon restarts, a prior response_id is unavailable, a browser tab closes, or the agent resumes a partially completed tool turn. Avoid restarting ChatGPT with a prompt that could repeat accepted local mutations.

## Implementation steps

1. Treat lost outstanding in-memory broker state as a terminal recoverable error with guidance to start a new task.
2. Allow safe replay of the exact undelivered tool-call batch only while its authenticated session remains active.
3. Keep native Codex compaction unchanged and document any generic compaction limitations.

## Acceptance criteria

- Restart after tool execution does not automatically repeat a write operation.
- Closed-browser and expired-session follow-ups fail explicitly.
- Response_id replay never attaches to another session or permits secret/token reuse.

## Required validation and evidence

Simulate daemon restart, browser close and duplicate reconnect during a write-tool round.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
