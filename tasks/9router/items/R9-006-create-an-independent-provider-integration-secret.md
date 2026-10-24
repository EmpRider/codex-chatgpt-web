# R9-006 — Create an independent provider integration secret

- **Epic:** [R9-E02 — Additive 9Router Responses provider surface](../epics/R9-E02-provider-interface.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-005](../items/R9-005-introduce-a-namespaced-feature-gated-integration-route.md)

## Detailed description

Implement a dedicated API key used by 9Router to authenticate requests to the new provider surface. Never reuse ChatGPT cookies, the OpenAI tunnel runtime key, native Codex authentication, or the launcher's privileged administration token. Keep the credential outside Git and command-line arguments.

## Implementation steps

1. Define secure generation, storage, rotation and explicit disable/delete behavior for the integration key.
2. Require Authorization: Bearer for applicable provider endpoints, using timing-safe comparison.
3. Reject missing, wrong, expired or malformed credentials without exposing secret values in logs.

## Acceptance criteria

- Integration routes reject unauthenticated calls while native Codex behavior is unaffected.
- Key material is never included in logs, model responses, docs or process argv.
- Rotation leaves no silently accepted old key unless an explicit documented transition policy applies.

## Required validation and evidence

Offline auth tests exercise missing/bad/good/revoked keys, redaction and inherited native routes.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/chatgpt-web-models.ts
- https://github.com/decolua/9router/blob/master/src/app/api/provider-nodes/route.js
- https://github.com/decolua/9router/blob/master/open-sse/executors/default.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
