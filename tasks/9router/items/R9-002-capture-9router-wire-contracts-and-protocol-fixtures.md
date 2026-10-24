# R9-002 — Capture 9Router wire contracts and protocol fixtures

- **Epic:** [R9-E01 — Reference-first baseline and interface contract](../epics/R9-E01-reference-contract.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-001](../items/R9-001-record-pinned-source-baselines-and-upstream-divergence.md)

## Detailed description

Inspect the 9Router generic OpenAI-compatible Responses provider, executor URL construction, Bearer forwarding, model alias resolution, Claude-to-OpenAI conversion and streamed tool-call conversion. Create scrubbed JSON/SSE fixtures for the request and response shapes we genuinely expect from unmodified 9Router.

## Implementation steps

1. Capture plain prompt, standard function-tool declaration, Claude tool_use/tool_result, nested alias and streaming Responses cases.
2. Document headers 9Router preserves or drops; never depend on forwarded private Codex headers.
3. Provide examples of tool call IDs and result correlation with both text and structured results.

## Acceptance criteria

- Fixtures are valid JSON or SSE and can be consumed by automated tests.
- The contract explicitly names lossy transformations and unsupported 9Router-specific features.
- Every protocol assumption includes a pinned 9Router source reference.

## Required validation and evidence

Use the unmodified 9Router translator or its tests to compare fixture inputs with observed output.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/architecture.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/decolua/9router/blob/master/open-sse/translator/

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
