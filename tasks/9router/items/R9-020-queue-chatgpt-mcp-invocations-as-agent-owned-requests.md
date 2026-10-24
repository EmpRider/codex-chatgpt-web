# R9-020 — Queue ChatGPT MCP invocations as agent-owned requests

- **Epic:** [R9-E05 — Round-trip tool calls and browser continuation](../epics/R9-E05-tool-loop.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-016](../items/R9-016-extend-turnbroker-with-external-agent-scoped-capabilities.md), [R9-017](../items/R9-017-expose-agent-neutral-inventory-and-calls-through-existing-mcp-tunnel.md), [R9-019](../items/R9-019-preserve-browser-and-tunnel-lifecycle-through-external-tool-rounds.md)

## Detailed description

Implement the external tool-request handoff using TurnBroker pending invocations. A browser MCP call must become a validated pending action owned by the requesting coding agent and never run inside the daemon.

## Implementation steps

1. Assign an opaque unique call_id and preserve the exact public tool name and parsed arguments.
2. Queue requests in a bounded session-scoped structure and wake the waiting provider Responses handler.
3. Check the active advertised catalog again when the model requests a tool.

## Acceptance criteria

- An MCP call produces an inspectable pending tool request with no file or process side effects.
- Unknown or revoked tool names fail closed before being returned to the agent.
- The pending connector call stays unresolved until an actual tool result arrives.

## Required validation and evidence

Use a fake MCP invocation and inspect broker lifecycle before any simulated tool_result.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
