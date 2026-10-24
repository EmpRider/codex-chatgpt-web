# R9-036 — Implement feature rollback and upstream regression guard

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-005](../items/R9-005-introduce-a-namespaced-feature-gated-integration-route.md), [R9-019](../items/R9-019-preserve-browser-and-tunnel-lifecycle-through-external-tool-rounds.md), [R9-035](../items/R9-035-add-privacy-safe-diagnostics-and-correlation-ids.md)

## Detailed description

Ensure operators can disable 9Router functionality without uninstalling or damaging native Codex integration. Keep the fork's newly introduced files isolated and document a repeatable reference-first upstream-sync check so future upstream code updates remain mergeable.

## Implementation steps

1. Test feature-enabled and disabled start/stop paths and existing launcher modes.
2. Create an upstream-touchpoint list and enforce a documented review for any inherited-file edits.
3. Provide a rollback procedure for disabling provider routes and safely retiring external sessions.

## Acceptance criteria

- Feature-off behavior matches the reference baseline for native endpoints and UI.
- Rollback does not remove ChatGPT login, Codex config, or OpenAI tunnel credentials.
- Upstream change check lists touched inherited files and regression tests.

## Required validation and evidence

Run native tests with the feature switched off and perform a dry-run rollback test.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/openai/tunnel-client/blob/master/docs/connectors.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
