# R9-009 — Resolve provider aliases and endpoint URL compatibility

- **Epic:** [R9-E02 — Additive 9Router Responses provider surface](../epics/R9-E02-provider-interface.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-002](../items/R9-002-capture-9router-wire-contracts-and-protocol-fixtures.md), [R9-007](../items/R9-007-implement-openai-style-model-discovery.md), [R9-008](../items/R9-008-accept-validate-and-stream-external-responses-requests.md)

## Detailed description

Prove that 9Router's `apiType: responses` executor calls the intended provider URL with the right model name and bearer credential. Guard against duplicate `/responses`, double `/v1` prefixes, model aliases containing slashes and variants of local IPv4 hostnames.

## Implementation steps

1. Document a concrete custom Responses provider node using the fork loopback base URL.
2. Normalize only the API route model namespace, without guessing unsupported model names.
3. Test 9Router's nested alias handling such as `ccw/chatgpt-web/<model>` and connector model discovery.

## Acceptance criteria

- An unmodified 9Router executor reaches the fork route with a stable model ID.
- Bad prefixes fail clearly instead of selecting another model/provider.
- Windows localhost setup and same-host networking assumptions are explicit.

## Required validation and evidence

Run a fixture-backed 9Router executor request and inspect requested URL, auth header and model.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/chatgpt-web-models.ts
- https://github.com/decolua/9router/blob/master/src/app/api/provider-nodes/route.js
- https://github.com/decolua/9router/blob/master/open-sse/executors/default.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
