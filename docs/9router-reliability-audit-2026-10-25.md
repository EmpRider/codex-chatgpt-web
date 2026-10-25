# 9Router vs. native Codex: reliability audit (2026-10-25)

## Verdict

**Not yet production-certified.** The browser and 9Router runtime now have tested, bounded
recovery for several additional failure paths. The 9Router transport cannot yet promise
exactly-once response delivery after an HTTP disconnect, a service restart, or the loss of an
accepted browser conversation. Those guarantees need a stable client request identity,
durable response journal, and end-to-end retry protocol; the current 9Router Responses
contract does not supply them. Never substitute a fresh Send for a lost accepted turn.

The changes in `fix/9router-browser-recovery` are isolated to this fork. The native Codex
workflow remains in place. Browser-worker safeguards are shared intentionally; the native
request/identity and sandbox-permission protocols were not replaced.

## Architecture and behavior comparison

| Layer | Native Codex adapter | 9Router external-agent provider | Audit outcome |
| --- | --- | --- | --- |
| Turn identity | Native thread/turn identity, retry key, execution namespace, in-memory reconnect journal | External-agent history and opaque broker owner token; no trustworthy native turn ID | 9Router cannot replay a disconnected SSE turn exactly once; do not fabricate native identity |
| Browser submission | Shared `ChatGptBrowserWorker`; explicit Send evidence, completion fence | Same worker, external-agent prompt and capability-limited broker | Previous fix restores a collapsed leased viewport before Send and rebinds the same accepted page afterward; retry remains pre-Send-only |
| Tool authority | Native Codex tool owner and sandbox metadata | Caller-declared functions; originating agent executes them through MCP | 9Router does not inherit native filesystem privileges; structured results and JSON Schema remain validated |
| Tool delivery | Broker queues and replays call IDs; owner journals reconnect | Same broker, but session lifecycle is bound to Responses function-call-output continuations | Rejects ambiguous/expired continuations and partial batch handoffs; still lacks durable client acknowledgment of delivered call IDs |
| Text delivery | Adapter publishes incremental text while browser remains active | Previously buffered text until a terminal/tool stage | Now sends incremental SSE text; uses final DOM text to append only missing suffix and errors on divergent projections |
| Timeouts | Stage deadlines with suspension-clock refund, DOM health, MCP invocation deadline | Shared browser deadlines plus external HTTP stage and tool-result deadlines | 30-minute finite *awake* stage watchdog, 60-second body-upload budget, 80-second outstanding-tool-result TTL, and 10-second adapter heartbeats |
| Cancel/reconnect | Native observer can detach while its exact session survives for reconnect | Provider currently retires the external owner on HTTP disconnect | Cancel races repaired; exact reconnect/resume is a remaining protocol gap |
| Shutdown | Native broker and launcher drains/retirement | Broker-owner sessions in memory | Registration reserves capacity before await; late registrations are revoked after close, without starting a browser |
| Backpressure | SSE bridge and bounded adapter event queue | Same bridge; delayed stage completion previously masked as inactivity | Stage heartbeat now stops on settlement/disconnect; output buffer is bounded; still limited by downstream consumer behavior |
| Request input | Native request-body decoder | Same decoder, externally authenticated sidecar | 9Router adds incremental upload-size enforcement, cancellation, a 60-second body-read deadline, and actionable HTTP body errors |

## Confirmed reliability defects and fixes

| Severity | Defect / root cause | Change | Verification |
| --- | --- | --- | --- |
| High | Two or more simultaneous `start()` calls could pass `sessions.size < 5` before asynchronous broker registration, oversubscribing browser tabs | Reserve a slot synchronously across registration; release on all outcomes | Five delayed registrations reject sixth; 75-turn mixed-failure run |
| High | `closeAll()` did not own registrations that had not yet resolved; a late broker response could spawn an orphan browser after shutdown | Permanent closed flag, post-registration check, late-token revocation | Delayed registration + shutdown regression |
| High | A hanging browser helper or broker waiter could keep SSE adapter heartbeats running forever, suppressing the bridge's silence watchdog | Finite 30-minute browser-stage deadline, abort race, session retirement, suspension-aware clock | Hung broker *and* uncooperative browser synthetic test returns 504, active owner count zero |
| High | `continue()` attached cancellation only after tool-result handoff; a hung `completeTool()` could block disconnection indefinitely | Attach cancellation before handoff, race each broker completion against owner revocation, fail closed on ambiguous partial handoff | Hung `completeTool()` + simultaneous HTTP cancellation regression |
| High | Browser final answer could be truncated: `pendingText || settled.text` preferred a non-empty partial delta to the complete DOM answer | Reconcile authoritative final DOM answer with streamed and previously delivered text; reject contradictions | Incremental text + delayed final suffix; deliberately divergent response; multi-stage tool-output stream |
| High | 9Router did not emit model text until completion or a tool boundary | Forward browser text deltas directly to active SSE observers; do not replay them in final stage | Partial text observable before browser finishes; exact once delta concatenation |
| High | Unsupported freeform tool calls were noticed only while formatting the response after a broker batch had been handed off | Validate at `nextStage()` before publishing a call and retire the owner on error | Synthetic freeform batch fails with 422, no pending session |
| High | A mutation-stage timeout could wait indefinitely for its aborted action's cleanup | Bound cleanup grace to 10 seconds; fail closed without a replacement mutation | Non-cooperative browser mutation exits with actionable error |
| High | Stale CDP `browser.close()` could hang forever and prevent safe same-page rebind | Bound disconnect wait to 10 seconds; never open replacement until old transport is confirmed closed | Non-settling disconnect fails closed with zero replacement attempts |
| Medium | A recurring viewport collapse could reset the consecutive rebind counter forever and exhaust resources over a long turn | Bound total same-page recoveries to eight per turn, in addition to two consecutive failures | Simulated intermittent successful recoveries followed by ninth failure |
| Medium | A client disconnect could leave heartbeat intervals operating against a dead queue | Explicit heartbeat disposer on cancellation and settlement | Never-settling stage + stream disconnect test |
| Medium | External turn text could accumulate without any memory limit | 8,000,000-character cap across delivered, pending, and final-only DOM text, with explicit failure | Oversized incremental and final-only synthetic browser text regressions |
| Medium | `readJsonRequestBody()` used an unbounded `arrayBuffer()` wait for 9Router HTTP uploads and surfaced large-body errors as generic 502 | Incremental bounded 9Router body read; cancellation; 408/413/415 statuses | Hanging upload, oversized Content-Length, zstd parity, HTTP 413 response |

The earlier branch also included **pre-Send viewport retry**, **same-page DOM rebind after
Send**, **adapter-stage heartbeat**, **stream cancellation propagation**, and the
**broker-registration cancellation race**. These remain covered by browser-worker and
9Router provider regression tests.

## Fault-injection matrix

| Synthetic scenario | Expected invariant | Result |
| --- | --- | --- |
| Collapsed 1×1 viewport before Send | Maximum one fresh page attempt, same token, no duplicate Send | Pass |
| Collapsed viewport / DOM probe after Send | Rebind same page or fail; never retry Send | Pass |
| CDP disconnect never settles | Do not open overlapping replacement transport | Pass |
| Browser mutation ignores abort | Bound cleanup and fail, do not retry mutation | Pass |
| Broker never answers and browser ignores abort | Bound stage, revoke owner | Pass |
| Five registrations delayed simultaneously plus sixth request | Hard cap of five leases | Pass |
| Shutdown while registering | Late token revoked, no browser start | Pass |
| SSE consumer disconnects mid-turn | Abort exact 9Router owner and stop queue heartbeat | Pass |
| Tool result handoff never acknowledges, then HTTP cancellation | Stop waiting, retire owner, no blind replay | Pass |
| Unsupported freeform tool batch | No fabricated function-call delivery | Pass |
| Browser streams partial text then finishes later | Text visible before completion; suffix exactly once | Pass |
| Final DOM contradicts prior SSE text | Failed response, never false completed | Pass |
| Tool result after multiple SSE rounds | Preserve earlier deltas and avoid replay on continuation | Pass |
| 75 turns: successes, pre-Send viewport errors, cancellation, post-Send crashes, hard hangs | All 75 owners retired, Send count bounded, retries only before Send | Pass |
| HTTP upload never yields data | Deadline returns 408, stream canceled | Pass |
| Declared HTTP body exceeds 64 MiB | Reject before allocation with 413 | Pass |
| zstd request body | Preserve existing native decode behavior | Pass |
| Stdio MCP Read/Edit/Bash synthetic cycle | One browser turn, no duplicate agent tools, final answer intact | Pass |

These are deterministic local tests with synthetic runners, a local IPC broker and, in
the MCP cycle, a real stdio MCP client. They are not substitutes for live ChatGPT or
9Router telemetry. The stress test exercises 75 short turns, **not** hours of real
browser execution or verified OS-level process termination.

## Regression evidence

- Targeted 9Router/browser-worker run: **211 passed, 0 failed** before the later additional
  upload, stress, streaming-handoff and harness cases were added.
- Broader changed-component suite: 231 passed, 6 skipped and one fixture mismatch, then
  the fixture was corrected to return a coherent full browser DOM projection; the real
  stdio MCP harness passed when rerun.
- Entire repository: **1,106 passed, 91 skipped, 4 failed**, 1,201 tests in 85 files,
  9,341 assertions; Bun 1.4.0, Linux runner, 2026-10-25.
- Four full-suite failures are unrelated to these edits: one test assumes a synthetic
  proxy-only host must reject bare `fetch`, which this execution environment can reach;
  three Electron launcher-dependent Zero Risk compaction tests cannot resolve Electron
  dependencies in this container. Treat as environment-blocked, not green.
- `bun x --no-install --bun tsc --noEmit` and `git diff --check` passed before final
  audit documentation. Re-run as part of CI before merging.

## Remaining risk register (do not silently paper over)

### Release blockers / high severity

1. **HTTP/SSE reconnect with no stable idempotency key.** A lost connection after the
   agent receives an accepted tool call but before acknowledgment cannot be distinguished
   from a new request by history alone. Native Codex has a reconnect journal; 9Router does
   not. Remedy requires a stable gateway-propagated request ID, durable output/call ledger,
   and an explicit replay/acknowledgment contract. Never resubmit a previously accepted
   browser prompt to fake recovery.
2. **90-second native MCP tool invocation limit / 80-second external-result TTL.** Long-running
   agent-side tools can exceed those boundaries. Extending only the 9Router TTL would not
   extend the actual ChatGPT-side MCP wait and could misstate execution outcomes. Requires
   end-to-end asynchronous tool completion or deadline negotiation across both transports.
3. **Browser process death after accepted Send.** A same-page rebind works only while the
   leased ChatGPT conversation still exists and can be identified. If the whole browser
   session disappears, a fresh Send would violate at-most-once semantics; fail explicitly.
4. **Missing live Windows/ChatGPT/9Router/Electron tests.** No test in this audit proved
   actual renderer freeze, Windows suspended laptop, network partition through the
   original 9Router, multi-account browser session recovery, or a production signed build.

### Important follow-up risks

5. **State loss across daemon restart.** 9Router session/pending-call maps are process-local.
   Restart expires all outstanding call IDs. The current behavior returns 409 rather than
   replaying possibly mutating tools; a durable journal is required to do better.
6. **Concurrent client retries after a partially delivered SSE response.** No stable
   transport transaction ID or delivery acknowledgment exists. Current safety is fail-closed,
   not transparent replay, and operational monitoring should make the failure visible.
7. **Large-context resource pressure.** The HTTP envelope allows up to 64 MiB encoded / 128
   MiB decompressed, multiple sessions may retain copies, and `Bun.zstdDecompress()` materializes
   decompressed bytes before their size can be checked. Streamed zstd expansion limits and
   aggregate per-process memory admission are not yet verified.
8. **Client-side 9Router translation and compaction.** Upstream 9Router may alter Responses
   metadata, tool results, context history, SSE framing or deadlines before they reach this
   fork. Synthetic fixture tests cannot prove live upstream equivalence; validate the
   unmodified binary and the real coding agents together.
9. **UI-specific failure modes.** Duplicate named connector rows, stale public tunnels,
   UI virtualization and altered ChatGPT page semantics may still fail closed. Selecting an
   arbitrary first connector is unsafe because it can send operations to a stale plugin.

## Production validation gates

Before declaring the system production-ready, perform and retain live evidence for:

1. Windows packaged Electron build, browser-login rotation, 1×1 viewport, renderer crash,
   tab destruction, browser process kill, machine sleep/resume, and leaked CDP connections.
2. At least one real multi-hour coding task with tool calls; ten concurrent trial tasks with
   backpressure, cancellation, rapid retries, network loss, 409/413/429 responses, and logs
   of call IDs / exact execution counts (not tool inputs or secret content).
3. Slow (>80s), crashing and partially executed agent-side tools, including a CLI process
   killed after receiving a mutating tool call; explicitly demonstrate no duplicate writes.
4. Actual 9Router plus Claude Code, Codex and OpenCode: streamed text appears promptly,
   partial SSE disconnect produces correct incomplete/failed state, history and compaction
   survive, and no promised reconnect succeeds by rerunning a side effect.
5. CI with the complete Electron test dependencies, native-network expectations adjusted for
   the runner, memory/handle leak measurements, and release artifact smoke tests.

The implementation is materially safer and its tested paths are bounded. **It is not
correct to call an unrecoverable network/process fault invisible to the coding agent.**
The safe outcome is an actionable failure, not a fabricated `response.completed` or
an unguarded second tool execution.
