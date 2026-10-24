# R9-003 — Approve agent-neutral execution and trust-boundary design

- **Epic:** [R9-E01 — Reference-first baseline and interface contract](../epics/R9-E01-reference-contract.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-001](../items/R9-001-record-pinned-source-baselines-and-upstream-divergence.md), [R9-002](../items/R9-002-capture-9router-wire-contracts-and-protocol-fixtures.md)

## Detailed description

Write a design decision explaining why the coding agent, not the fork, owns local tool execution, approvals and sandbox enforcement. Distinguish native Codex trusted environment claims from untrusted generic API request data. Define the separate generic turn identity and forbid synthetic cwd, writable roots or native permissions.

## Implementation steps

1. Specify a discriminated interface for native Codex and external-agent turns.
2. Describe how a model may request only tools present in the latest request's allowlist.
3. Define the OpenAI Tunnel's role solely as the ChatGPT-to-MCP transport and outline threat boundaries.

## Acceptance criteria

- A reviewer can identify which component executes tools and enforces permission checks.
- Generic requests cannot be treated as verified native Codex environment metadata.
- Design preserves existing browser-only, Full and Zero Risk paths unchanged by default.

## Required validation and evidence

Security-review the sequence diagram against upstream docs/security-model.md invariants.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/architecture.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/decolua/9router/blob/master/open-sse/translator/

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
