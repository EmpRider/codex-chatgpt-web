# R9-011 — Normalize advertised tools and validate input schemas

- **Epic:** [R9-E03 — Normalize external-agent requests and trust](../epics/R9-E03-neutral-context.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-008](../items/R9-008-accept-validate-and-stream-external-responses-requests.md), [R9-010](../items/R9-010-normalize-system-developer-user-and-assistant-history.md)

## Detailed description

Convert request-local OpenAI Responses function definitions into a normalized tool catalog the ChatGPT MCP bridge can safely enumerate. Preserve exact public tool names, parameter schemas and descriptions, and prevent one tool declaration from overwriting another by accidental aliasing.

## Implementation steps

1. Support ordinary `type:function` tools and validate name, JSON schema, descriptions and size limits.
2. Detect duplicates, invalid names, reserved bridge names and unsupported tool types with deterministic errors.
3. Keep original exposed wire names alongside any internal collision-safe identifier.

## Acceptance criteria

- Only currently advertised callable tools appear in generic inventory.
- Malformed/duplicate tools are rejected before ChatGPT sees them.
- No tool is executed by this parsing step.

## Required validation and evidence

Use table-driven tests for real Claude-translated, Codex and OpenAI tool definitions.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/responses/parser.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/environment.ts
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
