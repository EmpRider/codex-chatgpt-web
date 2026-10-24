# R9-039 — Test against an unchanged local 9Router installation

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-027](../items/R9-027-verify-claude-code-tool-use-and-tool-result-conversion.md), [R9-029](../items/R9-029-verify-opencode-and-standard-openai-agent-clients.md), [R9-031](../items/R9-031-validate-model-alias-routing-discovery-and-streaming-fidelity.md), [R9-038](../items/R9-038-build-a-synthetic-browser-mcp-turnbroker-integration-harness.md)

## Detailed description

Run an offline end-to-end loop through a clean, unmodified 9Router installation and the fork's mocked provider/browser handler. Verify that 9Router's generic Responses provider supports Claude and OpenAI clients without patches, and publish the exact version and commands used.

## Implementation steps

1. Create a throwaway local provider node, test key and synthetic model without altering 9Router source.
2. Send Claude Messages tool_use/tool_result and OpenAI Responses tool-output conversations through 9Router.
3. Compare translated IDs, names, arguments, role ordering, final text and failure semantics.

## Acceptance criteria

- Mocked Claude Code and OpenAI client tool calls survive the full 9Router path.
- 9Router source tree remains unmodified; no custom 9Router plugin is required.
- All incompatibilities are documented with reproducible fixtures.

## Required validation and evidence

Record 9Router commit/version, offline test command and redacted request/response traces.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
