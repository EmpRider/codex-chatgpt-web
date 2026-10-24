# R9-012 — Map tool_choice and special tool kinds safely

- **Epic:** [R9-E03 — Normalize external-agent requests and trust](../epics/R9-E03-neutral-context.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-011](../items/R9-011-normalize-advertised-tools-and-validate-input-schemas.md)

## Detailed description

Honor supported `tool_choice` behavior and identify native Codex-only special tool types so 9Router does not receive tool events it cannot translate. In particular, generic Claude-facing ToolSearch must travel as an ordinary function if the caller advertised it; native `tool_search_call` remains available solely on the native path.

## Implementation steps

1. Map auto/required/none and explicit function selection when representable.
2. Classify freeform/custom tools, native tool_search and deferred discovery as supported or rejected per source protocol.
3. Preserve native Codex special event serialization behind its existing code path.

## Acceptance criteria

- Generic responses never emit an unsupported special event by accident.
- Tool-choice restrictions cannot be bypassed by the browser connector.
- Each unsupported kind produces a named compatibility error and test fixture.

## Required validation and evidence

Assert response event types against 9Router's translator behavior for Claude and Responses requests.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/responses/parser.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/environment.ts
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
