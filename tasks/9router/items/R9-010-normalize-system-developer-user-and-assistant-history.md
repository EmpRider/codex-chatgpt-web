# R9-010 — Normalize system, developer, user and assistant history

- **Epic:** [R9-E03 — Normalize external-agent requests and trust](../epics/R9-E03-neutral-context.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-008](../items/R9-008-accept-validate-and-stream-external-responses-requests.md), [R9-002](../items/R9-002-capture-9router-wire-contracts-and-protocol-fixtures.md)

## Detailed description

Build a pure adapter from 9Router-forwarded Responses bodies to an agent-neutral ordered conversation. Preserve visible instruction priorities and tool-use history, including multi-part text and image blocks, without claiming Codex task identity or relocating instructions into user content.

## Implementation steps

1. Decode Responses `instructions`, `input` message records and prior assistant function calls.
2. Retain stable message order and explicit provenance labels for system, developer, user and tool content.
3. Identify fields lost in Claude/OpenAI translation and return a precise error when loss prevents safe continuation.

## Acceptance criteria

- System/developer content remains distinct from untrusted tool output.
- Multi-message and multimodal fixtures survive normalization without invented payloads.
- No generic history is accepted as native Codex rollout authority.

## Required validation and evidence

Snapshot normalized context for each 9Router fixture and compare to request source roles.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/responses/parser.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/environment.ts
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
