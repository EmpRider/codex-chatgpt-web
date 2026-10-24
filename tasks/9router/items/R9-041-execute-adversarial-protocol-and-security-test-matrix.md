# R9-041 — Execute adversarial protocol and security test matrix

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-032](../items/R9-032-harden-auth-origins-cors-and-credential-boundaries.md), [R9-033](../items/R9-033-bound-mcp-calls-http-streams-cancellations-and-timeouts.md), [R9-034](../items/R9-034-enforce-session-concurrency-and-account-browser-isolation.md), [R9-035](../items/R9-035-add-privacy-safe-diagnostics-and-correlation-ids.md)

## Detailed description

Test abuse cases and failure paths that could leak credentials or execute unexpected code: forged tool result, prompt-injected fake environment, replayed call IDs, wrong-provider key, oversized payload, dropped 9Router metadata, interrupted streaming and browser disconnect.

## Implementation steps

1. Implement deterministic negative fixtures and cross-session attempts.
2. Verify no tool runs inside the fork, and every external tool invocation is explicitly returned to the client.
3. Validate redacted logs and fail-closed response types under induced timeout/cancellation.

## Acceptance criteria

- No unauthorized tool call reaches an agent or changes browser state.
- Known 9Router translation losses are surfaced, not silently repaired with guessed data.
- All test failures include request stages and actionable error categories.

## Required validation and evidence

Save a per-case PASS/FAIL table with fixture IDs and safe trace hashes.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
