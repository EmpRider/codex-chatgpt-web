# R9-014 — Define deterministic external turn and browser-session ownership

- **Epic:** [R9-E03 — Normalize external-agent requests and trust](../epics/R9-E03-neutral-context.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-010](../items/R9-010-normalize-system-developer-user-and-assistant-history.md), [R9-013](../items/R9-013-separate-external-tool-capability-from-trusted-codex-sandbox-state.md)

## Detailed description

Create a session identity policy that works when 9Router strips native Codex headers. Correlate browser sessions with authenticated provider identity and server-generated opaque IDs, plus validated outstanding tool call IDs, while forbidding untrusted clients from attaching results to another user's turn.

## Implementation steps

1. Specify new-turn creation, follow-up correlation, expiration, interruption and retained-context behavior.
2. Preserve call ID mapping and track session ownership without relying on arbitrary prompt strings.
3. Guard concurrent model requests, task restarts, response_id replay and missing continuation context.

## Acceptance criteria

- Parallel sessions cannot share broker tokens or cross-consume tool results.
- Lost session state fails explicitly instead of replaying side effects.
- Session tests cover missing, duplicate, expired and forged continuation identifiers.

## Required validation and evidence

Simulate two clients with overlapping call IDs and attempted cross-session result delivery.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/responses/parser.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/environment.ts
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
