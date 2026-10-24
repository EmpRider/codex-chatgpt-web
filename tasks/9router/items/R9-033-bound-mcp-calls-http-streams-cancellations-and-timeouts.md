# R9-033 — Bound MCP calls, HTTP streams, cancellations and timeouts

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-019](../items/R9-019-preserve-browser-and-tunnel-lifecycle-through-external-tool-rounds.md), [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md)

## Detailed description

Define coherent deadlines among OpenAI tunnel's hosted MCP budget, the fork's MCP invocation limit, browser liveness and 9Router/provider HTTP timeouts. Implement fail-closed cancellation and call revocation without retrying a mutating tool after ambiguous delivery.

## Implementation steps

1. Use existing tunnel-bound invocation limits and per-request abort signals.
2. Propagate cancellation to broker waiters and release browser activity leases after terminal failure.
3. Expose separate errors for tool timeout, MCP disconnect, client abort and ambiguous ChatGPT Send.

## Acceptance criteria

- No abandoned tool promise persists after bounded cleanup.
- Mutating tool calls are never automatically resent after an uncertain execution result.
- Tests prove long tool calls fail explicitly before the tunnel hard deadline.

## Required validation and evidence

Use virtual timers and cancellation tests for different races around queued, delivered and completed tool states.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/openai/tunnel-client/blob/master/docs/connectors.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
