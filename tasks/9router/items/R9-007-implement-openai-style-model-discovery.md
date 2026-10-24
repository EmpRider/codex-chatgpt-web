# R9-007 — Implement OpenAI-style model discovery

- **Epic:** [R9-E02 — Additive 9Router Responses provider surface](../epics/R9-E02-provider-interface.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-005](../items/R9-005-introduce-a-namespaced-feature-gated-integration-route.md), [R9-006](../items/R9-006-create-an-independent-provider-integration-secret.md)

## Detailed description

Expose GET `/integrations/9router/v1/models` with OpenAI list semantics and current authenticated ChatGPT Web model availability. Unlike the native Codex catalog, provide stable model `id` fields suitable for 9Router model import while preserving exact model/effort binding.

## Implementation steps

1. Map only the currently configured ChatGPT Web model slugs and visible capabilities.
2. Return `{object:'list',data:[...]}` with id, object and suitable metadata, without claiming untested capabilities.
3. Document authorization and the no-silent-fallback policy when an account model is unavailable.

## Acceptance criteria

- 9Router can import the model IDs from a deterministic mocked catalogue.
- Model availability and route identity match the existing fork's capability matrix.
- Native Codex `/models` response remains unchanged.

## Required validation and evidence

Contract tests validate list schema, empty/unavailable model cases and dual-catalog isolation.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/chatgpt-web-models.ts
- https://github.com/decolua/9router/blob/master/src/app/api/provider-nodes/route.js
- https://github.com/decolua/9router/blob/master/open-sse/executors/default.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
