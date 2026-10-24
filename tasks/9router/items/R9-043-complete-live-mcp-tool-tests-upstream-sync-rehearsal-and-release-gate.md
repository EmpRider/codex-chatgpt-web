# R9-043 — Complete live MCP tool tests, upstream-sync rehearsal and release gate

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-038](../items/R9-038-build-a-synthetic-browser-mcp-turnbroker-integration-harness.md), [R9-039](../items/R9-039-test-against-an-unchanged-local-9router-installation.md), [R9-040](../items/R9-040-run-direct-native-codex-and-multi-client-regression-suites.md), [R9-041](../items/R9-041-execute-adversarial-protocol-and-security-test-matrix.md), [R9-042](../items/R9-042-document-9router-installation-and-agent-setup-on-windows.md)

## Detailed description

After offline acceptance, perform user-authorized live tests with a signed-in ChatGPT account and its configured OpenAI Tunnel connector. Verify Claude Code tool requests, real agent-owned file operations and a full final answer through 9Router; compare fork against latest upstream and document release/rollback status. Live results must never be simulated.

## Implementation steps

1. Manually run read, safe file-edit, installed MCP and skill-tool flows with explicit user permissions.
2. Observe actual 9Router translation, ChatGPT browser continuation and local tool approval behavior.
3. Rebase/merge rehearsal against current upstream; record any conflicts and release blockers.

## Acceptance criteria

- Real Claude Code → 9Router → fork → ChatGPT Web → tool → Claude Code loop is evidenced by sanitized live logs.
- The existing native Codex route works after the change, and upstream-sync rehearsal is recorded.
- Release gate remains blocked until live credential/account-dependent checks are genuinely completed.

## Required validation and evidence

Attach redacted live transcript, exact tested versions, test matrix and release/rollback decision.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
