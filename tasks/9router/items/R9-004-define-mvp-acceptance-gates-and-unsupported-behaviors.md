# R9-004 — Define MVP acceptance gates and unsupported behaviors

- **Epic:** [R9-E01 — Reference-first baseline and interface contract](../epics/R9-E01-reference-contract.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-002](../items/R9-002-capture-9router-wire-contracts-and-protocol-fixtures.md), [R9-003](../items/R9-003-approve-agent-neutral-execution-and-trust-boundary-design.md)

## Detailed description

Create a capability matrix distinguishing standard function calls, MCP tools, skills as prompts, skills exposed as functions, deferred discovery, freeform/custom calls and agent-specific hooks. Define offline and account-bound live gates so the implementation never claims unsupported capabilities or simulates an actual browser verification.

## Implementation steps

1. List Claude Code, Codex via 9Router and OpenCode flows separately, including request/response formats.
2. Make single tool calls, parallel calls, tool errors and multi-round continuation mandatory MVP checks.
3. Mark proprietary agent hooks, hidden metadata and live login/connector tests as conditional or manual with required evidence.

## Acceptance criteria

- Every MVP feature has observable pass/fail evidence and a responsible layer.
- Live acceptance cannot be marked Done based solely on mock tests.
- Unknown or discarded 9Router semantics are recorded as explicit limitations.

## Required validation and evidence

Review matrix against fixtures and reference-first ADR.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/architecture.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/decolua/9router/blob/master/open-sse/translator/

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
