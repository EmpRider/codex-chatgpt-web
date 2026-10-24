# R9-025 — Preserve tool errors, output formats and image evidence

- **Epic:** [R9-E05 — Round-trip tool calls and browser continuation](../epics/R9-E05-tool-loop.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md)

## Detailed description

Ensure tool execution failures, structured MCP results, text-only output and image-bearing tool results survive the return path as accurately as possible. Document where 9Router's Claude/OpenAI translators necessarily convert or drop rich blocks.

## Implementation steps

1. Normalize `isError`, structuredContent, text blocks and image references without exposing arbitrary local file paths.
2. Preserve a raw error category and call ID for diagnostic display.
3. Explicitly reject or report unsupported binary/image tool-result paths rather than returning empty success.

## Acceptance criteria

- Failed commands are represented as failures to ChatGPT and the caller.
- Multimodal results are preserved where protocol supports them; otherwise limitations are explicit.
- No arbitrary image URL is fabricated to replace missing bytes.

## Required validation and evidence

Fixture tests cover text, JSON, failure, image and mixed-content tool results.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
