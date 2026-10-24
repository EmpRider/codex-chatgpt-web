# R9-032 — Harden auth, origins, CORS and credential boundaries

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-006](../items/R9-006-create-an-independent-provider-integration-secret.md), [R9-013](../items/R9-013-separate-external-tool-capability-from-trusted-codex-sandbox-state.md)

## Detailed description

Audit all new provider endpoints for unauthorized access, local browser-origin requests, request smuggling, cross-client tool authorization and credential leaks. Keep the existing loopback security model, but recognize that generic 9Router provider traffic is an independent local principal requiring a separate integration key.

## Implementation steps

1. Reject unauthorized provider requests and untrusted Origin values consistent with existing daemon policy.
2. Limit request sizes, accepted content types and origins, without opening public listeners.
3. Sanitize all errors and logs so tunnel IDs, provider keys, cookies and client environment secrets are not emitted.

## Acceptance criteria

- Unauthorized clients cannot query tools, models or a pending turn.
- No integration code bypasses native Codex permission checks or executes the caller's tools.
- Security tests show no new unauthenticated write or lifecycle endpoint.

## Required validation and evidence

Run negative auth/Origin/schema tests and grep emitted logs for injected fake secrets.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/openai/tunnel-client/blob/master/docs/connectors.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
