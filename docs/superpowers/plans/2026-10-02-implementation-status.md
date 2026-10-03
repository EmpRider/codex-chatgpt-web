# Optimization implementation status — 2 October 2026

Branch: `perf/reliable-turns-and-preparation` from `22b93ed` (v6.2.7).
This is an initial implementation stage of the approved 26-item report, not a release.

## Implemented

- Native batches renew their inactivity deadline only when a distinct result is delivered. Total batch waiting is capped at twice the configured inactivity allowance. Heartbeats, touches and invalid results do not renew it.
- Duplicate call IDs are validated before publishing a batch, so a rejected batch cannot leave partial outstanding state.
- Result diagnostics include a hashed call ID, elapsed time, completed count and unresolved count. Timeout messages describe outstanding work and retain the unknown-outcome/no-automatic-retry contract.
- Dedicated terminal polling caps requested observation yield at 30 seconds, below the 90-second MCP invocation limit. Session IDs, input characters and outputs are preserved. The public connector tool description/schema are unchanged.
- Cross-request token estimates use a 1,024-entry digest/count cache with five-minute expiry and no globally retained prompt text. The existing request-local cache and tokenization algorithm remain intact.
- Strict JSON schemas reuse compiled validators within 16-entry / 512 KiB serialized-schema bounds. Each compiled schema has its own AJV registry; mutable caller schemas cannot change an existing compiled validator.
- Browser selection skips redundant picker reopening only when fresh closed-label evidence identifies BOTH the requested family and exact effort. Generic/ambiguous labels use the existing confirmation flow. Selection still precedes prompt entry.
- Completed Responses history is prepared between turns. The next continuation reuses normalized history, validates new input/current options, and preserves reasoning boundaries, historically loaded tools, compaction markers, images, current model and raw replay provenance.
- Preparation can reuse a prepared ancestor. The queue is limited to four histories; ready state to eight entries / approximately 4 MiB; individual input eligibility is 1 MiB. Requests never wait for optional preparation. Invalid, changed, expired, oversized or unavailable state takes the normal parser path.
- A replay-content digest check protects existing mutable raw-body behavior; normalized state is cloned before an adapter can mutate it. This retains an O(history bytes) check and copy, so this is not an O(new input only) pipeline.
- Tool-call metadata is indexed during normalization, preserving the old first-call-within-assistant / newest-assistant duplicate-ID semantics.

## Measurements

Synthetic 331,081-byte history, 160 command/result pairs, five warm-ups, 30 samples per path, using `bun scripts/benchmark-prepared-history.ts`:

| Local parser path | Median | p95 |
|---|---:|---:|
| Cold parsing after call-ID indexing | 1.53 ms | 3.67 ms |
| Prepared prefix | 1.24 ms | 4.25 ms |

The median improved in this sample; p95 did not. These are noisy microbenchmark observations, not an end-to-end latency claim. Browser submission, model queues and external tools were not measured. Preparation remains synchronous CPU work within each bounded history and yields between histories.

## Validation

- TypeScript typecheck passes.
- Connector contract and terminal polling integration tests pass without changing the published connector ABI.
- Parser equivalence, fresh options, mutation isolation, branch behavior, loaded tools, compaction/images, queue/cache bounds, ancestry reuse and duplicate call-ID semantics pass targeted tests.
- Independent review ran 22 focused tests successfully and found an effort-rollback bug in the first fast-path draft. Exact-effort matching and a regression were added to correct it.
- Initial full suite: 924 passed, 22 skipped, four failed. One network test failed identically on unchanged main because the runtime supplied an outbound proxy. Three launcher tests lacked Electron. After installing the pinned launcher dependency and clearing inherited proxy variables for those tests, the affected two suites passed all 13 tests.
- Playwright's standard Chromium download returned truncated archives. A workspace-only packaged Chromium was used instead: all six real-browser effort-picker fixtures passed, including both one-open layouts, hydration, disappearing options and newly locked efforts. This validates fixtures, not the live authenticated ChatGPT site.

### Final verification — 3 October 2026

- Complete repository suite: **929 passed, 22 skipped, 0 failed**, 6,821 assertions across 81 files. Command: `env -u HTTP_PROXY -u HTTPS_PROXY -u ALL_PROXY -u http_proxy -u https_proxy -u all_proxy bun test ./tests`.
- Six of those skipped browser fixtures were then run separately using `CHATGPT_DOM_TEST_BROWSER`: **6 passed, 0 failed**, 16 assertions. The remaining 16 skips retain their existing platform/fixture conditions.
- TypeScript `tsc --noEmit` and `git diff --check` pass.
- Independent reviewer rechecked the exact-effort fix: four focused tests passed and the reported blocker is resolved.
- No merge or release has been performed. Windows and authenticated live-site behavior are not covered by these Linux fixture runs.

## Remaining report scope

No durable cross-process job journal or generic asynchronous-job protocol is claimed. No change makes an unknown side effect automatically safe to replay. A single silent unresolved call can still reach its watchdog deadline.

Remaining work includes independent per-tool execution/queue budgets, durable acknowledgement/reconciliation, generic asynchronous jobs where client protocols support them, shared raw-history blocks and incremental size accounting, shared environment/configuration caches, canonical prompt-fragment reuse, prompt-policy deduplication, diagnostic snapshot sampling/writes, deeper DOM extraction changes, optional-service budgets and additional independent-stage overlap. Windows and live authenticated ChatGPT validation remain release gates.
