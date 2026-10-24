# R9-017 — Expose agent-neutral inventory and calls through existing MCP tunnel

- **Epic:** [R9-E04 — Reuse the OpenAI Tunnel, browser and MCP capability broker](../epics/R9-E04-mcp-adapter.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-011](../items/R9-011-normalize-advertised-tools-and-validate-input-schemas.md), [R9-016](../items/R9-016-extend-turnbroker-with-external-agent-scoped-capabilities.md)

## Detailed description

Adapt the existing ChatGPT-side MCP discovery-and-call mechanism to external agent tools, preserving OpenAI Tunnel transport. Decide explicitly whether the current connector's stable tool schema can be reused or whether a separately named connector is necessary; never silently replace a cached ChatGPT connector schema.

## Implementation steps

1. Bind inventory to the external session's tool list and expose exact tool name/schema/description.
2. Map generic invocation arguments to broker requests, not to local shell or filesystem execution.
3. Document connector identity migration/setup if a schema or contract change is required.

## Acceptance criteria

- MCP inventory returns only advertised generic tools and excludes native-only controls.
- MCP calls create broker requests but perform no direct OS effects.
- Existing `Codex Native2` and Zero Risk connector modes remain usable.

## Required validation and evidence

Run mocked MCP tools/list and tools/call round trips through a real stdio server binding.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/mcp-server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/prompt.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/tunnel.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
