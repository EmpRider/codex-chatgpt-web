# R9-013 — Separate external tool capability from trusted Codex sandbox state

- **Epic:** [R9-E03 — Normalize external-agent requests and trust](../epics/R9-E03-neutral-context.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-003](../items/R9-003-approve-agent-neutral-execution-and-trust-boundary-design.md), [R9-011](../items/R9-011-normalize-advertised-tools-and-validate-input-schemas.md)

## Detailed description

Introduce a discriminated external-agent execution context that can describe advertised tool permissions but cannot impersonate a verified Codex workspace environment. The remote model may request a listed tool; actual filesystem, terminal, network and approval authority remains inside the initiating coding agent.

## Implementation steps

1. Define distinct `native-codex` and `external-agent` context types and enforce exhaustive branching.
2. Reject any attempt to elevate generic prompt text, headers or environment-looking XML to sandbox authority.
3. Keep native Codex `cwd`, writable roots and sandbox validation unchanged.

## Acceptance criteria

- Generic sessions never populate fake Codex cwd/roots/sandbox fields.
- Tool execution occurs only after returning an actual tool call to the client.
- Native Codex context validation and associated regression tests still pass.

## Required validation and evidence

Add negative tests for forged `<environment_context>`, fake thread metadata and malicious tool schemas.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/responses/parser.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/environment.ts
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
