# R9-021 — Serialize standard Responses tool-call events and call IDs

- **Epic:** [R9-E05 — Round-trip tool calls and browser continuation](../epics/R9-E05-tool-loop.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-012](../items/R9-012-map-tool-choice-and-special-tool-kinds-safely.md), [R9-020](../items/R9-020-queue-chatgpt-mcp-invocations-as-agent-owned-requests.md)

## Detailed description

Convert pending generic broker requests to standard `function_call` response items suitable for 9Router's Responses translator. Preserve `call_id`, `name`, JSON `arguments` and completed item status without emitting Codex-only custom or tool_search events for generic clients.

## Implementation steps

1. Emit valid SSE `response.output_item.added`, argument deltas/done, output item done and final turn events.
2. Support non-streaming output when the provider interface promises it.
3. Map namespaced tools to wire names without breaking 9Router or introducing duplicate identifiers.

## Acceptance criteria

- 9Router converts function_call events to Claude tool_use for standard tools.
- Each returned call_id is unique per session and stable across replay.
- Native Codex custom_tool_call and tool_search serialization remains unchanged.

## Required validation and evidence

Replay a multiple-function-call SSE fixture through the 9Router response translator.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
