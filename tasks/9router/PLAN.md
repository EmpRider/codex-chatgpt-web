# 9Router → ChatGPT Web: fork-only implementation plan

> Planning baseline: 2026-10-24. Implementation status: **not started**. This change creates planning and tracking files only.

## 1. Goal and placement

Insert unmodified 9Router **between the coding agent and the fork's Responses API**, at the location highlighted in the user's architecture screenshot. The existing browser, custom MCP connector, outbound OpenAI tunnel and TurnBroker remain downstream of the fork's Responses daemon.

- **Coding agents:** Claude Code, Codex, OpenCode and any other client whose ordinary tool-call protocol 9Router can translate.
- **Gateway:** 9Router's existing custom OpenAI-compatible Responses provider node.
- **Provider:** EmpRider/codex-chatgpt-web; serves ChatGPT Web via a separate authenticated, versioned API namespace.
- **Tool executor:** always the initiating coding agent. 9Router translates messages; the fork and MCP bridge relay tool calls/results. Neither 9Router nor the fork installs or executes the agent's tools.
- **Preserve:** native direct Codex route, browser-only/Full/Zero Risk, launcher, account state, model selection, official OpenAI tunnel-client and ChatGPT custom MCP connector.

No source changes are permitted to decolua/9router or miuuyy/codex-chatgpt-web. The extension is additive and opt-in. It reduces upstream conflicts through isolation but cannot mathematically guarantee conflict-free future merges.

## 2. Full tool round

1. A coding agent sends Claude Messages, OpenAI Chat Completions or OpenAI Responses traffic to 9Router, including current tools and instructions.
2. 9Router translates and dispatches to its generic Responses provider: the fork's authenticated localhost integration endpoint.
3. The fork validates the provider key, model, ordered history and request-local tool declarations, then creates a generic-agent turn.
4. Existing ChatGPT Web browser machinery sends the task to one task-bound browser conversation. Full-mode OpenAI tunnel and MCP connector expose a turn-scoped view of those tools.
5. ChatGPT requests a tool through its custom MCP connector. The OpenAI tunnel forwards MCP JSON-RPC to the fork's local stdio server; TurnBroker queues the request **without executing anything**.
6. The fork returns standard Responses function_call output items (call_id, name, arguments). For Claude, 9Router translates these into Claude tool_use.
7. The **coding agent** executes its local Read/Edit/Bash/MCP/Skill-as-tool under the agent's own approval/sandbox policy.
8. The agent returns a tool_result; 9Router converts it to Responses function_call_output; the fork validates session/call_id, resolves the pending MCP request with the genuine result, and resumes **the same** ChatGPT browser response.
9. Repeat for further or parallel tools; return the final assistant answer through 9Router.

The browser must not physically re-send the prompt for every tool result.

## 3. Proposed external API (not implemented yet)

| Endpoint | Contract |
| --- | --- |
| GET /integrations/9router/v1/models | OpenAI-style object=list and data array with stable model id values |
| POST /integrations/9router/v1/responses | Authenticated OpenAI Responses-shaped input and SSE / supported non-streaming output |
| Authorization | Dedicated fork-generated Bearer API key; never tunnel, ChatGPT cookie, Codex or launcher admin secret |
| Feature switch | Disabled by default; explicit enable/disable and credential rotation |

Example 9Router configuration: Custom OpenAI-compatible, apiType responses, node name ChatGPT Web, prefix ccw, base URL http://127.0.0.1:17841/integrations/9router/v1, model alias ccw/chatgpt-web/MODEL_SLUG. The port is illustrative: use the daemon's configured listening port. Confirm exact UI labels and import flow with the pinned 9Router build.

Do not silently fall back between models or claim an unsupported tool feature. Do not overwrite existing native Codex model catalog or native Responses behavior.

## 4. Proposed fork code layout

New modules in a fork-owned namespace (names subject to baseline/ADR review):

- src/integrations/nine-router/routes.ts — method/path dispatch, errors, authentication.
- src/integrations/nine-router/models.ts — OpenAI model discovery and strict mapping.
- src/integrations/nine-router/request.ts — Responses request, history and tool normalization.
- src/integrations/nine-router/agent-context.ts — discriminated external turn identity and tool allowlist.
- src/integrations/nine-router/session-manager.ts — browser/HTTP continuation correlation and expiration.
- src/integrations/nine-router/adapter.ts — existing ChatGPT worker, prompt and broker under generic owner.
- src/integrations/nine-router/response.ts — SSE tool events and real result handback.
- tests/integrations/nine-router — offline unit, protocol, lifecycle and failure fixtures.

Possible minimal inherited hooks: src/server.ts for route dispatch; src/adapters/chatgpt-web/index.ts for pluggable turn owner; MCP server, broker and prompt compiler only where their existing types cannot safely model external turns. Every inherited edit requires evidence of why an isolated extension was insufficient.

Never populate the verified native Codex environment (cwd, writable roots, sandbox) from untrusted generic API body or prompt text. External agents receive a narrower context: advertised tools are **requests the client may execute**, not permissions to run OS operations in the fork.

## 5. Compatibility contract

| Capability | MVP target | Limitations |
| --- | --- | --- |
| Plain text and streaming | Required | SSE needs translation tests |
| Standard Responses function_call/output | Required | Preserve stable call IDs |
| Claude tool_use/tool_result | Required via 9Router | 9Router transformations can lose detail |
| Read, Bash, Edit and filesystem tools | Required through agent | Fork never executes locally |
| MCP tools | Required if advertised | Request-scoped catalog |
| Skills in instructions | Preserve | Does not guarantee native skill behavior |
| Skill/plugin tools | Standard callable functions | Agent executes them |
| Sequential and parallel tool rounds | Required | Strict outstanding result matching |
| Native custom and tool_search calls | Direct Codex unchanged | Not automatically portable through generic 9Router |
| Proprietary client hooks, hidden metadata, subagents | Conditional | Test per client, disclose unsupported cases |
| Browser login/tunnel connector | Reuse Full mode | Live account testing required |

No blanket promise that **every** plugin or proprietary feature works in **every** coding agent. Unsupported or dropped translation data is reported honestly.

## 6. Security and lifecycle

1. Provider traffic requires independent authentication and loopback/origin protections; the OpenAI tunnel runtime key is never reused as provider auth.
2. A generic request cannot assert native Codex sandbox authority. The client owns local command execution and all approvals.
3. Match tool output to authenticated session and outstanding call ID. Reject duplicated, unsolicited, expired and cross-session results.
4. Bound call deadlines against hosted OpenAI Tunnel's 120-second service budget and upstream's present 90-second MCP invocation timeout. Cancel/revoke on disconnect, never blind-retry possibly mutating calls after ambiguous delivery.
5. Retain the upstream task-bound browser limit and ownership. Fail explicitly when capacity or prior continuation state is missing; do not hijack another conversation.
6. Log privacy-safe IDs and stage timings only, not prompts, arguments, cookies, keys, browser state, tunnel IDs or local absolute user paths.
7. Disabled mode and rollback leave all existing native Codex routes, browser credentials and connector behavior untouched.

## 7. Phases and gates

| Phase | Epic | Deliverable |
| --- | --- | --- |
| P0 | R9-E01 | Pinned references, wire fixtures, security decision, acceptance matrix |
| P1 | R9-E02 | Authenticated provider endpoints and model list |
| P2 | R9-E03 | Generic request context, tool catalog and session identity |
| P3 | R9-E04 | Existing OpenAI Tunnel/MCP/TurnBroker reused under generic owner |
| P4 | R9-E05 | SSE function calls, genuine results, sequential and parallel continuation |
| P5 | R9-E06 | Claude Code, Codex and OpenCode interoperability via unmodified 9Router |
| P6 | R9-E07 | Security, cancellation, isolation, observability and rollback |
| P7 | R9-E08 | Offline tests, docs, real account-bound acceptance and release evidence |

**MVP release gate:** a real Claude Code → unmodified 9Router → fork → ChatGPT Web → client-owned local tool → 9Router → same ChatGPT response → final Claude Code answer, with Read/Edit/Bash/MCP scenarios, plus native Codex regression evidence. Offline mock evidence is necessary but not sufficient to claim the live route works.

Before release: run relevant root tests, bun run typecheck, bun run verify, launcher checks, adversarial fixtures and upstream merge rehearsal. A live ChatGPT sign-in, tunnel connector and agent tool E2E test must be performed with explicit user authorization; do not simulate success.

## 8. Reference-first rule and design risks

Every task begins by reading its detailed description, owning epic, current sources and upstream/9Router reference implementation. Port proven behavior when relevant; explain deviations before coding. Build tests at the smallest meaningful scope and attach verifiable evidence before marking done.

Known risks:
- 9Router's Claude↔OpenAI translator may discard proprietary thinking, image or tool metadata.
- Generic requests usually lack native Codex trust headers, so session correlation cannot rely on them.
- ChatGPT connector schemas may be cached by connector identity; adding a new external-agent MCP interface may require a separate connector identity rather than quietly altering Codex Native2.
- Long tools must finish or fail inside hosted tunnel deadlines without repeating side effects.
- Upstream CONTRIBUTING.md excludes generic provider work; keep it fork-only.

## 9. Tracking and baseline

Tasks live in one manifest, eight epic specs and 43 individually described task files. See README.md for commands and evidence policy. All tasks begin as **todo**; planning research has not been counted as finished implementation.

Pinned planning-time commits: fork/main and upstream/main both 0901b9fb1976b4a984c7e9b4082c2868767bbf7c; unmodified 9Router/master f39d8f07481ae8518e93175f0ecaaafa61573c6c, observed 2026-10-24. Refresh this baseline before coding or merging upstream updates.
