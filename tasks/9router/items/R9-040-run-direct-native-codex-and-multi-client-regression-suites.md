# R9-040 — Run direct native Codex and multi-client regression suites

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-028](../items/R9-028-preserve-direct-codex-and-codex-via-9router-behavior.md), [R9-039](../items/R9-039-test-against-an-unchanged-local-9router-installation.md), [R9-036](../items/R9-036-implement-feature-rollback-and-upstream-regression-guard.md)

## Detailed description

Prevent the new integration from regressing existing Codex workflows, model catalogue, tool discovery, native custom/freeform execution, compaction and subagent behavior. Keep the generic feature behind its opt-in configuration throughout these tests.

## Implementation steps

1. Run existing Bun test, typecheck and repository verify commands.
2. Test native Full, browser-only and Zero Risk behavior using offline fixtures where possible.
3. Run separate mock agent concurrency and protocol paths with the feature enabled.

## Acceptance criteria

- All relevant existing offline tests pass with the feature disabled.
- Generic tests do not require native Codex metadata or modify Codex user config.
- Any native regression is fixed before live integration proceeds.

## Required validation and evidence

Attach safe command logs and a concise before/after regression report.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
