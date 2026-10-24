# R9-005 — Introduce a namespaced, feature-gated integration route

- **Epic:** [R9-E02 — Additive 9Router Responses provider surface](../epics/R9-E02-provider-interface.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-003](../items/R9-003-approve-agent-neutral-execution-and-trust-boundary-design.md)

## Detailed description

Add a small dispatch seam in the daemon for `/integrations/9router/v1/*` while retaining the existing native `/v1/responses`, `/models`, compaction and authenticated lifecycle routes. Keep all new implementation in fork-owned modules and leave the provider disabled when not configured.

## Implementation steps

1. Register GET models and POST responses handlers behind an explicit integration setting.
2. Apply exact method/path matching to avoid intercepting native Codex traffic or browser-origin protections.
3. Return explicit unavailable errors when feature is disabled, draining or misconfigured.

## Acceptance criteria

- Feature-off requests follow prior behavior byte-for-byte for native routes.
- Feature-on integration routes are reachable only at the documented namespace.
- Route tests detect conflicts with health, lifecycle, compaction, native forwarding and websocket negotiation.

## Required validation and evidence

Compare existing src/server.ts route tests with the feature disabled and enabled.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/chatgpt-web-models.ts
- https://github.com/decolua/9router/blob/master/src/app/api/provider-nodes/route.js
- https://github.com/decolua/9router/blob/master/open-sse/executors/default.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
