# R9-015 — Define pluggable agent turn owner for the browser adapter

- **Epic:** [R9-E04 — Reuse the OpenAI Tunnel, browser and MCP capability broker](../epics/R9-E04-mcp-adapter.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-013](../items/R9-013-separate-external-tool-capability-from-trusted-codex-sandbox-state.md), [R9-014](../items/R9-014-define-deterministic-external-turn-and-browser-session-ownership.md)

## Detailed description

Create an adapter seam around browser preparation and tool ownership, so the same ChatGPT Web worker may receive either a genuine native Codex environment or an external-agent capability catalog. Keep existing native trust assertions in their current branch and avoid a broad refactor of the browser worker.

## Implementation steps

1. Identify the smallest existing adapter integration points for prompt preparation, broker registration and continuation.
2. Use explicit turn owner types and adapter factories rather than model-name conditionals.
3. Keep Full, browser-only, Zero Risk and DEV harness semantics stable.

## Acceptance criteria

- Native adapter behavior and outputs are unchanged when generic mode is disabled.
- External-agent owner does not require a fabricated Codex thread or cwd.
- Tests demonstrate separate native and generic adapter dispatch.

## Required validation and evidence

Run existing adapter/session tests before and after enabling the new owner with mock transport.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/mcp-server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/prompt.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/tunnel.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
