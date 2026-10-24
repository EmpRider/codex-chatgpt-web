# R9-034 — Enforce session concurrency and account/browser isolation

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-014](../items/R9-014-define-deterministic-external-turn-and-browser-session-ownership.md), [R9-019](../items/R9-019-preserve-browser-and-tunnel-lifecycle-through-external-tool-rounds.md), [R9-024](../items/R9-024-handle-parallel-tool-batches-deterministically.md)

## Detailed description

Prevent conversations and tool capabilities from crossing between clients, provider keys, browser tabs or concurrent requests. Reuse existing task-bound tab leases and finite browser/session limits, and define how multiple coding agents on one local 9Router instance share the account safely.

## Implementation steps

1. Associate every browser lease and broker token with one authenticated external session.
2. Reject a sixth task according to existing ChatGPT browser limits rather than silently stealing a tab.
3. Cleanly retire sessions on disconnect, logout, model/effort change or explicit cancel.

## Acceptance criteria

- Interleaved two-agent tests produce no cross-session tool or answer leakage.
- Browser tab capacity failures are explicit and recoverable.
- A released session cannot receive newly arriving tool results.

## Required validation and evidence

Load test mock parallel agent turns and verify token/channel/tab identifiers remain disjoint.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/openai/tunnel-client/blob/master/docs/connectors.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
