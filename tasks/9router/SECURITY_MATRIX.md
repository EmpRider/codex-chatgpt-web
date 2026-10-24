# Adversarial 9Router provider evidence (offline)

Run: `bun test tests/nine-router-provider.test.ts tests/nine-router-mcp.test.ts tests/nine-router-harness.test.ts tests/turn-broker-lifecycle.test.ts tests/nine-router-upstream-guard.test.ts`.

All scenarios below use a synthetic ChatGPT browser and real in-process broker. The two MCP suites additionally spawn the real fork's existing stdio MCP server. **No test executes a coding agent's file/shell tool.** Every returned result is explicitly supplied by the test harness.

| Case | Expected security behavior | Fixture/test | Offline outcome |
| --- | --- | --- | --- |
| P-01: Missing/wrong provider key | Auth 401, no browser owner created; no key echo | `dedicated 9Router endpoint...`; `provider logs and error envelopes...` | PASS |
| P-02: Malicious browser `Origin` | 403 at original loopback Bun listener; no permissive CORS headers | `loopback security rejects browser-origin POSTs` | PASS |
| P-03: Invalid request JSON/media type | 400/415 before model submission | `invalid provider media type and malformed JSON` | PASS |
| P-04: Oversized/unknown tools | Bound inventory, reject invalid type/name/schema and bridge aliases | `9Router request rejects unknown control items...`; `validates external function schemas...` | PASS |
| P-05: Prompt-injected forged native workspace | Input remains quoted text; no native sandbox/roots privilege | `external tool inventory never promotes forged workspace metadata...` | PASS |
| P-06: Unauthorized native shortcut | `codex_exec`, `codex_apply_patch`, `codex_view_image` refused for external owners | `external 9Router agent can inventory...` | PASS |
| P-07: Forged/wrong-session output ID | Only an active call and exact conversation prefix may continue | `external agent tool call survives...`; `concurrent coding agents keep distinct session owners...` | PASS |
| P-08: Duplicate/missing/placeholder tool results | 409; never invent completion or execute duplicate results | `parallel broker calls require all tool outputs...` | PASS |
| P-09: Session shutdown/restart replay | Old `function_call_output` fails; does not create a new tool owner | `a daemon restart or closed browser never replays...` | PASS |
| P-10: Opaque response/conversation resume | Explicit 422; never silently map `previous_response_id` to a new browser | `9Router request rejects unknown control items...` | PASS |
| P-11: Request cancelled before tool delivery | Browser/broker owner revoked, no leaked pending wait | `disconnect before any tool delivery revokes...` | PASS |
| P-12: Agent never returns tool output | Session expires after bounded wait, broker token revoked | `abandoned external tool output automatically expires...` | PASS |
| P-13: Long model thinking | Session does **not** expire before first tool delivery | `a long ChatGPT thinking phase never expires...` | PASS |
| P-14: Sixth simultaneous agent | Enforce shared browser tab cap of five | `a sixth external coding agent cannot steal...` | PASS |
| P-15: Raw key, model, schema or prompt sentinel in logs | Only whitelisted request/trace/session hash/count/category fields | `provider logs and error envelopes never echo...` | PASS |
| P-16: Unsupported image URL/audio/freeform content | Explicit 422; no fabricated media or guessed tool calls | `inline images preserve attachment order...`; `structured MCP tool output...` | PASS |
| P-17: MCP JSON/image result | Inline image, `structuredContent`, isError returned intact when supplied | `structured MCP tool output...`; `external 9Router agent can inventory...` | PASS |
| P-18: Three successive agent actions | A single browser turn handles Read→Edit→Bash through real MCP and broker | `synthetic read/edit/test cycle traverses real stdio MCP...` | PASS |
| P-19: Actual 9Router translator metadata drop | Tool calls/history survive; Claude `tool_choice` and `is_error` are lost before the fork | `pinned unmodified 9Router translates Claude...` with `CODEX_9ROUTER_SOURCE` | PASS for observation; **KNOWN LIMITATION**, not a feature pass |

### Severity and limitations

- The provider rejects unsupported first-class custom/freeform calls, remote images/audio/files, and unrecognized Responses control items instead of executing or fabricating them.
- An actual malicious/buggy coding agent could lie about having performed a command. This fork cannot verify an external agent's filesystem independently and must never claim it can. Coding-agent approvals and results remain the originating agent's responsibility.
- The actual ChatGPT model is a nondeterministic external participant; these offline tests prove routing and error invariants, **not** that the model always chooses a desired function or that the real tunnel is connected.
- Real Windows login, 9Router runtime, Claude Code/OpenCode/Codex E2E, live cancellation and end-user UI permission checks are **PENDING** release gates. See [IMPLEMENTATION.md](IMPLEMENTATION.md) and [WINDOWS_SETUP.md](WINDOWS_SETUP.md).

### Log correlation

- A single request has an opaque `request_id` like `r9_<random>`. Continuations create new request IDs.
- The browser turn keeps a random `trace_id` shared with `[chatgpt-web] broker trace=...` records; `session_hash` is a 12-digit SHA-256 prefix of the independent MCP turn token, **not the token itself**.
- Safe stages: `auth_rejected`, `request_started`, `browser_started`, `tool_batch_delivered`, `tool_results_returned`, `browser_finished`, `session_retired`, `parse_rejected`, `request_failed`. Logs never contain request JSON, prompts, arguments, tool output, provider key or browser cookies.
- For bug reports supply the stage/category/status/counts and redacted timestamps. Never attach credential files or full browser logs containing account details.
