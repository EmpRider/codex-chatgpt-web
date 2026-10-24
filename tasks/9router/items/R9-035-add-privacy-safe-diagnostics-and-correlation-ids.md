# R9-035 — Add privacy-safe diagnostics and correlation IDs

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-021](../items/R9-021-serialize-standard-responses-tool-call-events-and-call-ids.md), [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md), [R9-033](../items/R9-033-bound-mcp-calls-http-streams-cancellations-and-timeouts.md)

## Detailed description

Make generic request failures diagnosable without leaking prompts, tool payloads, keys or browser session data. Use request/session/tool call correlation hashes and stage names to distinguish routing, translation, browser, tunnel, broker and external-agent failures.

## Implementation steps

1. Define structured log fields for provider request ID, redacted session hash, model route, call lifecycle and error category.
2. Capture counts and bounded durations without logging tool arguments or secrets.
3. Document how to correlate 9Router logs with fork logs and safe exports.

## Acceptance criteria

- A broken tool round can be traced through stages using only safe IDs.
- Secret fixtures do not appear in diagnostics or error bodies.
- Failure classification distinguishes parser, model, timeout, browser and tool execution errors.

## Required validation and evidence

Assert log redaction with injected sentinel secrets and run an interrupted tool-round fixture.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/openai/tunnel-client/blob/master/docs/connectors.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
