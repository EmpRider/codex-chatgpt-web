# R9-019 — Preserve browser and tunnel lifecycle through external tool rounds

- **Epic:** [R9-E04 — Reuse the OpenAI Tunnel, browser and MCP capability broker](../epics/R9-E04-mcp-adapter.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-016](../items/R9-016-extend-turnbroker-with-external-agent-scoped-capabilities.md), [R9-017](../items/R9-017-expose-agent-neutral-inventory-and-calls-through-existing-mcp-tunnel.md), [R9-018](../items/R9-018-compile-truthful-generic-agent-prompts-plugins-and-skills-context.md)

## Detailed description

Ensure the existing browser tab and MCP connector remain attached while a coding agent executes its returned tools and submits results in a later HTTP request. Reuse the browser observer, settlement fence and session limit instead of starting another ChatGPT message for every tool response.

## Implementation steps

1. Keep accepted ChatGPT submissions tied to one browser turn until final completion or error.
2. Apply the current five-tab ownership and cleanup semantics to external sessions.
3. Prevent missing/dropped MCP calls from being treated as a completed answer.

## Acceptance criteria

- A two-tool mock exchange uses one browser response, not three separate ChatGPT prompts.
- No browser completion is acknowledged while the broker has unresolved calls.
- Tab and tunnel cleanup happens on success, cancellation and session expiration.

## Required validation and evidence

Instrument an offline browser-worker stub and assert send counts, active leases and final fences.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/mcp-server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/prompt.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/tunnel.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
