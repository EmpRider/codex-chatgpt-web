# R9-027 — Verify Claude Code tool_use and tool_result conversion

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-021](../items/R9-021-serialize-standard-responses-tool-call-events-and-call-ids.md), [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md)

## Detailed description

Exercise the complete unmodified 9Router Claude Messages → OpenAI Responses → Claude Messages path, including tool declarations, name mapping and tool result IDs. Confirm that Claude Code can own its Read, Bash, Edit and MCP tools while ChatGPT Web supplies model decisions.

## Implementation steps

1. Capture a realistic Claude request with instructions, tools and several messages.
2. Confirm 9Router translates fork `function_call` to Claude `tool_use` and returned `tool_result` to `function_call_output`.
3. Document any lossy Claude-specific thinking, cache-control or rich-tool metadata instead of inventing compatibility.

## Acceptance criteria

- A mocked Claude Code read/edit/tool-result loop traverses unmodified 9Router end to end.
- Tool IDs and names survive both translation directions.
- The repository contains fixtures and a reproducible offline test command.

## Required validation and evidence

Execute a local synthetic Claude Messages request through a pristine 9Router build.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
