# R9-008 — Accept, validate and stream external Responses requests

- **Epic:** [R9-E02 — Additive 9Router Responses provider surface](../epics/R9-E02-provider-interface.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-005](../items/R9-005-introduce-a-namespaced-feature-gated-integration-route.md), [R9-006](../items/R9-006-create-an-independent-provider-integration-secret.md)

## Detailed description

Implement POST `/integrations/9router/v1/responses` as a thin authenticated entry to the new external-agent adapter, not a recursive proxy to the native Codex route. Validate content type, body limits, model ID, stream option, permitted request fields and explicit unsupported features.

## Implementation steps

1. Define JSON error shapes, HTTP status mapping, SSE headers and response event ordering.
2. Handle client aborts and malformed bodies before allocating browser sessions.
3. Separate provider-facing request IDs from native Codex thread and turn IDs.

## Acceptance criteria

- Plain text requests return valid mocked Responses output in stream and non-stream modes as supported.
- Malformed requests and unavailable models produce deterministic errors, not browser retries.
- No generic request can automatically invoke native Codex-only operations.

## Required validation and evidence

Feed fixture JSON through the endpoint with a fake adapter and check exact status, headers and events.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/chatgpt-web-models.ts
- https://github.com/decolua/9router/blob/master/src/app/api/provider-nodes/route.js
- https://github.com/decolua/9router/blob/master/open-sse/executors/default.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
