# R9-001 — Record pinned source baselines and upstream divergence

- **Epic:** [R9-E01 — Reference-first baseline and interface contract](../epics/R9-E01-reference-contract.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** None

## Detailed description

Create a reference ledger naming the exact fork main commit, the upstream commit and the unmodified 9Router revision used for design. Compare the native Codex integration and existing tunnel/MCP modules before deciding which seams may safely be extended. This prevents a later upstream update from silently invalidating the design.

## Implementation steps

1. Record commit SHA, implementation files, routing assumptions, current feature flags, and current tests for each project.
2. Diff any overlapping fork files against upstream and mark ownership of each proposed change.
3. Specify a repeatable process to refresh the reference ledger before implementation and prior to every merge.

## Acceptance criteria

- Ledger includes immutable commit references and source URLs for each architectural claim.
- A recorded diff highlights inherited code versus new fork-owned additions.
- No upstream or 9Router changes are proposed as part of this task.

## Required validation and evidence

Review the recorded commit IDs and compare file hashes or diffs against GitHub at the pinned revisions.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/architecture.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/decolua/9router/blob/master/open-sse/translator/

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
