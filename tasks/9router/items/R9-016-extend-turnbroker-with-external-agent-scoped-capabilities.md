# R9-016 — Extend TurnBroker with external-agent scoped capabilities

- **Epic:** [R9-E04 — Reuse the OpenAI Tunnel, browser and MCP capability broker](../epics/R9-E04-mcp-adapter.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-015](../items/R9-015-define-pluggable-agent-turn-owner-for-the-browser-adapter.md)

## Detailed description

Reuse TurnBroker's bounded queue, opaque tokens and activity leases for a new external-agent context, while preserving native Codex exact-turn claims and safe-mode semantics. Ensure generic broker invocations can only reference the current request's validated tool allowlist.

## Implementation steps

1. Add generic channel registration, expiry and tool allowlist ownership without replacing native broker wire methods.
2. Preserve idempotent result completion, duplicate-call rejection, cancellation and retirement fences.
3. Separate runtime errors for generic versus native capability claims without leaking tokens.

## Acceptance criteria

- Native broker contract and existing ChatGPT connector remain compatible.
- External pending tools are request-scoped, not globally executable.
- Outstanding calls are cancelled and cleaned up when a generic session expires.

## Required validation and evidence

Run broker lifecycle tests across both context types and malformed token attempts.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/mcp-server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/prompt.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/tunnel.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
