# Async MCP tool lifecycle: implementation plan

**Status:** Proposed; design direction conditionally reviewed by Engineering Council. No implementation is claimed here. Separate implementation approval required.

**Design:** [async-mcp-tool-lifecycle-design-2026-10-27.md](async-mcp-tool-lifecycle-design-2026-10-27.md).

## Scope and sequencing

Implement the smallest safe fix in the existing provider and broker layers. Keep the original browser, native Codex mode, caller tool catalog, authentication, model selection and OpenAI-compatible endpoint contracts intact. Do not edit the coding agent or any intermediary client. Tool execution stays at the initiating coding agent.

### Phase 0 — Reproduce and identify capabilities

1. Freeze branch/commit and capture redacted, correlated `requestId`, `turnId`, `callId`, owner, helper and browser lease events across the existing MCP, broker and Responses layers. Do not log credentials, prompt bodies, files or raw tool parameters.
2. Reproduce two simultaneous tools: A takes more than 120 seconds and B completes within two seconds. Distinguish **B execution completed** from **model consumed B early**.
3. Measure behavior near the 80-second owner TTL, 90-second MCP invocation deadline and upstream tunnel lifetime; check abort/disconnect ordering and whether the original tool actually reached the agent.
4. Inspect real ChatGPT MCP host negotiation for Tasks support. Do not infer support from OpenAI API documentation or from the MCP specification. Record the active MCP protocol/SDK versions.

**Exit:** Timeline of every observed 409/timeout with actual queue/delivery/ACK state; documented client capability. If unavailable, keep deferred-tool work behind a decision gate.

### Phase 1 — Broker and timeout safety

Targets: `src/adapters/chatgpt-web/turn-broker.ts`, `src/adapters/chatgpt-web/mcp-server.ts`, focused lifecycle tests.

1. Reuse the existing per-call invocation map and ID generation; introduce no duplicate job scheduler or broad abstraction.
2. Distinguish calls still queued from delivered/unknown ones. Permit independent cancellation **only** when non-delivery is proven atomically, with bounded late-result tombstones.
3. Preserve existing fail-closed turn retirement when delivered operations might already have side effects; never convert an unknown execution into a retryable failure.
4. Log the exact retirement cause and per-call state. Ensure one transport abort cannot silently reassign work or leak results into another owner.
5. Keep 30-second agent waits and <=60-second command poll yields; never create an unbounded MCP request to bypass the 90-second guard.

**Exit:** Same-turn independent calls pass queued cancellation and delivered-unknown regression tests, without affecting original direct Codex behavior.

### Phase 2 — Generic Responses continuation safety

Targets: `src/integrations/agent-responses/session-manager.ts`, `routes.ts`, `attempt-journal.ts`, continuation tests.

1. Keep model, authenticated account, complete original conversation prefix, exact call IDs and genuine result checks at the trust boundary.
2. Retire owners with attributable reasons; expose truthful errors to the API client instead of hiding internal failures or automatically starting a new browser turn.
3. Preserve all-results-together continuation until a supported incremental contract has been designed and verified. Do **not** merely remove the completeness guard.
4. Keep side-effect uncertainty on timeout/restart fail-closed. Any durable journal is a separate minimal persistence decision; an in-memory record cannot substantiate cold recovery.

**Exit:** Missing owner, duplicate output, partial batch, concurrent continuation, history mismatch and restart cases remain deterministic and non-replaying.

### Phase 3 — Long-running jobs and bounded browser retention

Targets if Phase 0 proves necessary: `launcher/electron/browser-host.cjs`, `src/adapters/chatgpt-web/browser-worker.ts`, associated tests.

1. Tie browser retention to a real, authenticated active task lease with bounded heartbeat and cleanup. Keep the five-tab cap and avoid cross-turn URL-based reassignment.
2. Prefer established native job handles and bounded status polling. A transport-completed `taskId` must not be confused with a still-live original MCP RPC.
3. **Conditional:** if the actual client negotiates `io.modelcontextprotocol/tasks`, design/approve a separate SDK-v2 compatibility slice before adopting native Tasks. Never silently change the standard `tools/call` response shape.
4. If incremental model consumption is required, design a separate opt-in Responses continuation contract with explicit history, order and original `callId` semantics; it is not achieved by broker concurrency alone.

**Exit:** A long tool can be observed through supported polling while other executions progress. Unsupported hosts receive a precise capability/timeout result, not a fabricated completion.

### Phase 4 — Acceptance and release

| Test | Assertion |
| --- | --- |
| Slow A (140 s) + fast B (2 s), same turn | B execution is not blocked; each result matches its original call ID |
| Boundaries 79/81/89/91/121 s | Owner/MCP/tunnel retirement is explicit and correct |
| Queued cancellation vs delivered unknown | No accidental side effects or automatic retry |
| Concurrent owner mismatch | No cross-agent/account/browser result leak |
| Duplicated / missing / reordered outputs | Existing fail-closed continuation still holds |
| Browser lost, process restart, orphan callback | No forged completion or write replay |
| 6+ coding-agent sub-agents and 5-tab cap | Capacity errors and leases are bounded |
| Existing native modes and tool error/multimodal output | No regression |

Run focused tests first (`bun test ./tests/turn-broker-lifecycle.test.ts ./tests/agent-responses-mcp.test.ts ./tests/agent-responses-continuation.test.ts`), then `bun run typecheck` and the wider `bun test ./tests` suite with a bounded runner. Do **not** treat a five-minute hanging test command as evidence of success. Finally perform account-bound Windows/Bun/real coding-agent/ChatGPT MCP tests; report any missing authenticated capability honestly.

## Change controls and handoff

- One phase per reviewable diff. Test failure blocks the next phase; do not rewrite native paths for convenience.
- Keep user-facing protocol errors generic, diagnostically useful, and truthful. Log internal execution transitions privately with correlation IDs.
- No special recovery environment switch, auto-retry of mutations, unsolicited dependency migration or client-specific implementation names.
- Before landing Phase 3, explicitly confirm whether the user requires **parallel agent execution only** or also **incremental model continuation**; these have different contracts and risk profiles.
- Roll back only the new changes if native regression tests fail; never discard unrelated working-tree changes.

**Implementation approval:** Pending. Publishing these two planning documents does not authorize code changes or imply runtime tests have passed.
