# R9-029 — Verify OpenCode and standard OpenAI agent clients

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-021](../items/R9-021-serialize-standard-responses-tool-call-events-and-call-ids.md), [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md)

## Detailed description

Build contract fixtures for OpenCode or another OpenAI-tool-calling agent using 9Router, and ensure its local tools remain agent-owned. Support the standard request format that 9Router forwards rather than adding a separate provider-specific execution path for every coding agent.

## Implementation steps

1. Test Chat Completions-to-Responses and Responses-to-Responses translation as relevant to the configured 9Router API.
2. Cover instruction history, tool definitions, streamed calls, errors and result continuation.
3. Document which client configuration options and versions were verified.

## Acceptance criteria

- A mocked OpenCode-style function call returns to the initiating client and completes.
- No model-specific fork execution code is introduced for OpenCode.
- Unsupported client-only plugin features are noted as compatibility limitations.

## Required validation and evidence

Replay recorded OpenAI tool-call fixtures through unmodified 9Router into a mock fork endpoint.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
