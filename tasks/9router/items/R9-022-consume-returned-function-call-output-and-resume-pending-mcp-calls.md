# R9-022 — Consume returned function_call_output and resume pending MCP calls

- **Epic:** [R9-E05 — Round-trip tool calls and browser continuation](../epics/R9-E05-tool-loop.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-014](../items/R9-014-define-deterministic-external-turn-and-browser-session-ownership.md), [R9-020](../items/R9-020-queue-chatgpt-mcp-invocations-as-agent-owned-requests.md), [R9-021](../items/R9-021-serialize-standard-responses-tool-call-events-and-call-ids.md)

## Detailed description

When the coding agent submits tool results through 9Router, parse Responses `function_call_output` records, validate their outstanding call IDs, and resolve the exact pending broker promises. The original browser-side MCP call should then receive the actual text, structured output or error.

## Implementation steps

1. Match every result against session owner, outstanding call ID and expected tool identity.
2. Convert text/JSON/MCP result envelopes without fabricating success or dropping an `isError` indication.
3. Reject unsolicited, duplicate, mismatched or replayed results before changing browser state.

## Acceptance criteria

- One tool call's result becomes visible to the same ChatGPT response.
- A result from another session cannot resolve the pending call.
- Duplicate results produce deterministic errors without running the tool again.

## Required validation and evidence

Round-trip mocked `function_call` → `function_call_output` → MCP result with call ID assertions.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
