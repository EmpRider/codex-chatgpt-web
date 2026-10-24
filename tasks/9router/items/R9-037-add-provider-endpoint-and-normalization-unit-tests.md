# R9-037 — Add provider endpoint and normalization unit tests

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-008](../items/R9-008-accept-validate-and-stream-external-responses-requests.md), [R9-011](../items/R9-011-normalize-advertised-tools-and-validate-input-schemas.md), [R9-012](../items/R9-012-map-tool-choice-and-special-tool-kinds-safely.md)

## Detailed description

Build offline unit tests for request validation, auth, model list, instructions/history normalization, tool schema mapping, tool_choice and unsupported records. Tests must use synthetic fixtures and never require real ChatGPT login or secret keys.

## Implementation steps

1. Implement focused Bun tests with deterministic model and clock stubs.
2. Cover valid and invalid requests, streaming/non-streaming contract, namespaced functions and malformed tool schemas.
3. Make fixture file names and expected outputs readable as documentation.

## Acceptance criteria

- Tests run offline on Windows and a clean CI environment.
- No test calls ChatGPT, OpenAI Tunnel, 9Router account APIs or the user's machine tools.
- Failures identify the exact contract violated rather than generic snapshots only.

## Required validation and evidence

Run `bun test` scoped to new provider tests and compare existing native endpoint tests.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
