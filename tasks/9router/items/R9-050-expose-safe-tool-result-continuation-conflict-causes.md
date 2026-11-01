# R9-050 — Safe tool-result continuation diagnostics implementation plan

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Status and evidence:** [manifest.json](../manifest.json) is authoritative.
- **Dependencies:** R9-022, R9-027, and R9-035 (verified done before kickoff).
- **Task scope:** Diagnostic instrumentation only; the original continuation defect remains unresolved.

> Agentic execution uses one exclusive implementation specialist, independent QA, and the pinned debugging, TDD, verification, and review methods. PM alone owns this task record and all Git publication.

**Goal:** Distinguish the two existing pre-continuation HTTP 409 refusal sites through bounded, privacy-safe Activity diagnostics without changing accepted or rejected requests.

**Architecture:** Reuse the existing optional internal diagnostic code and closed Activity code allowlist. Do not add a logging subsystem or alter continuation state transitions.

**Tech stack:** Existing TypeScript provider and Activity modules, Bun tests, and the existing Node launcher logging tests; no new dependency.

**Spec:** The approved defect request seeks a successful tool-result continuation after a Read tool invocation. Council CW409-C1 authorizes only the discriminating diagnostic stage below because the permanent root cause is not yet established.

## Scope baseline and authority

Observed task evidence: a fresh text-only baseline succeeded; a Read tool call was delivered and executed through the connector; the subsequent continuation returned HTTP 409, including built-in CLI attempts. Existing diagnostics do not distinguish the two route refusal sites. This is not proof of their underlying cause.

The user authorized the localized investigation/fix and separately authorized publication of this sanitized task ledger on the existing feature branch. Source-code commits, source-code pushes, merge, deployment, installs, and changes to other repositories or installed agents remain unauthorized. Feature design and implementation-plan approvals are not applicable to this localized-defect path.

This task may implement only the Council-selected offline diagnostic change. A permanent repair requires new discriminating evidence and a subsequent Council remedy decision. A passing diagnostic test does not reproduce or resolve the original end-to-end defect.

## Global constraints

- Keep every existing guard predicate, guard order, fixed public message, numeric HTTP 409 status, and public response body unchanged.
- Preserve authentication, history, ownership, provenance, complete-batch validation, idempotency, journaling, and acknowledgement semantics.
- Preserve the evaluation count of `hasPendingCall`, which can evict expired entries; do not add a diagnostic probe call.
- Add only the two internal literals `continuation_new_user` and `continuation_no_owner`.
- Do not add events, fields, helpers, stores, dependencies, retries, fallback, or manager/parser/launcher production changes.
- Use generic provider naming in new code and descriptions; historical tracker paths are unchanged.
- Never record prompts, tool arguments/results, credentials, raw logs, private paths, or request/session/tunnel identifiers in this ledger or new diagnostics.
- Keep existing retention behavior unchanged: 300 in-memory events and the existing 4 MiB rotation threshold with one prior file. This is not a new hard aggregate-size or time-retention guarantee.
- Any application launch must be exactly `bun run app`. Any Claude Code live E2E invocation must explicitly use `--model haiku`.
- No Git operation by specialists; PM is the sole publication coordinator. No source-code commit or push is authorized.

## Ownership and dependencies

| Package | Accountable participant | Scope and handoff |
| --- | --- | --- |
| S1 | Source-loader specialist | Verified pinned source identities and receipts; excluded from the three technical-specialist requirement |
| S2 | Protocol diagnosis specialist | Read-only route/caller/continuation trace; cause remains unproven |
| S3 | Independent QA specialist | Test design, privacy/counterexample review, and independent verification; not the implementer |
| S4 | Implementation specialist | Exclusive writer of the six files listed below after PM verifies ledger publication and TL releases the bounded package |
| S5 | Independent Watchdog observer | Audit/compare-only pre-edit and later checkpoints; no repair authority |
| PM | Delivery and publication coordinator | Owns canonical ledger content, index, commits, pushes, and remote verification |
| TL | Technical coordinator and assumed EDO | Scope alignment, Council decisions, bounded handoffs, and technical sign-off |

S2, S3, and S4 are three distinct real agents. Each completed its assigned read-only package and personally read the applicable pinned instructions before the kickoff decision. S1 independently verified seven pinned repositories. No specialist code edits or test executions were represented as completed at kickoff.

## Review focus

1. Both route refusal guards must be distinguishable for both streaming and non-streaming requests.
2. Public HTTP status/body/messages must remain identical and must not leak the new internal code.
3. Refused requests must not claim/start journal work, start/continue a session, or acknowledge broker calls.
4. Valid pending continuations must retain existing behavior; diagnostics must not become a state-management workaround.
5. The Activity allowlist and launcher parser/export must retain privacy boundaries, reject unknown fields/codes, and exclude a unique secret canary.

## Bounded implementation steps

**Exclusive production paths:**

- `src/integrations/agent-responses/routes.ts`: add only the third constructor argument at the two existing 409 guards near baseline lines 211–215.
- `src/integrations/agent-responses/tool-policy.ts`: extend the existing optional diagnostic-code literal union.
- `src/activity-events.ts`: extend the existing closed `CODES` set.

**Exclusive test paths:**

- `tests/agent-responses-gateway-contract.test.ts`
- `tests/activity-events.test.ts`
- `launcher/tests/logging.test.cjs`

**Existing interfaces:** Consume the current validation-error constructor's optional internal diagnostic code and the existing Activity parser/export contract. Produce no new public API, event, field, helper, store, or changed signature.

- [ ] Verify the published task-ledger commit and the independent pre-edit drift checkpoint before the first code/test edit.
- [ ] Add route tests using the real provider/parser for both guards and both `stream=true` and `stream=false`. Assert the exact new `request_failed` code, unchanged fixed public response, and no refusal-side effects. The final `request_rejected` event legitimately remains `invalid_request`.
- [ ] Add closed-allowlist/privacy tests, including rejection of arbitrary fields/codes and absence of a unique secret canary.
- [ ] Add launcher parser/export coverage for both codes without changing launcher production code.
- [ ] Run the focused new tests against the old production behavior. Record an intended failure due to missing diagnostic differentiation, not an unrelated fixture failure.
- [ ] Apply the minimal three-file production change; preserve the exact existing rejection behavior.
- [ ] Rerun the focused tests and the relevant existing valid-continuation regressions.
- [ ] Have S3 independently review the assembled diff and run permitted verification. Record actual commands, outcomes, and any unavailable checks.
- [ ] Stop for TL/Council reassessment if the six-file boundary is insufficient or evidence suggests a behavior-changing repair.
- [ ] Obtain separate source-code publication authority before any source-code commit or push. Do not mark this task done from local edits or offline tests alone.

## Verification plan

All commands below were planned, not run, at kickoff. Confirm runner support and disposable fixture isolation before execution; never point tests at live app data, sockets, journals, or listeners.

```text
bun test ./tests/activity-events.test.ts ./tests/agent-responses-gateway-contract.test.ts ./tests/agent-responses-request.test.ts ./tests/agent-responses-continuation.test.ts ./tests/agent-responses-session.test.ts ./tests/agent-responses-attempt-journal.test.ts ./tests/agent-responses-harness.test.ts ./tests/agent-responses-mcp.test.ts
node --test launcher/tests/logging.test.cjs
bun run typecheck
```

A full `bun test ./tests` is conditional on verified isolation and scope. Do not automatically run `bun run verify`: its network audit/download/build effects require separate assessment. Do not install dependencies.

Expected diagnostic RED: old production behavior reports generic `invalid_request` at the two selected guards. Expected GREEN: the appropriate fixed internal code is visible through the existing safe diagnostics, while public rejection and valid-continuation behavior remain unchanged. Preserve evidence of the intended red/green distinction.

## Live E2E gate — waiting, not yet executed

Offline diagnostic approval does not itself clear live execution. Before one fresh Read-only invocation:

- Verify the actual patched runtime, correct listener, and attributable complete capture; do not confuse native and generic-provider listeners.
- Demonstrate that both stdout and stderr are allowlisted before tool-visible exposure, including failure paths.
- Specify and enforce a finite absolute wall-clock deadline and spend budget, with verified termination of only the owned invocation.
- Restrict the fixture to Read-only behavior and explicitly use `--model haiku`.
- Existing CLI automatic retries are allowed within the verified bounds; no added retry policy or manual replay. Record actual attempt count/order. Do not invent an exact request-count ceiling.
- Use the first attributable refusal to identify a rejection site; repeated attempts are correlated repetitions, not independent causal evidence.
- Stop on privacy exposure, unexpected tool behavior, runtime mismatch, or exhausted bounds. If capture or safe termination cannot be verified, keep live work blocked.

A diagnostic code identifies a guard, not its root cause. A later permanent repair requires an evidence-backed decision and its own tests. The broader live acceptance/release task remains separate.

## Council CW409-C1 — execution-readiness record

**Decision:** Select the narrow offline two-code diagnostic option. Reject speculative permanent repairs and defer comprehensive state instrumentation. Permanent root cause: **UNVERIFIED**.

**EDO:** Assumed technical-lead role, acting for reasoning/coordination only; not impersonating human approval. A private provisional position was recorded at 2026-11-01 12:10:13 UTC before advisor conclusions: evidence was insufficient for a permanent fix, so bounded discriminating evidence was preferred. The final substantive position remained unchanged and was narrowed to the two existing route codes.

**Independence:** Five real advisors used fresh contexts with identical neutral evidence. Requested model/effort: `gpt-6-astra` / `ultra`; effective settings were `NOT_EXPOSED`. Completed sessions released active capacity and the original advisor conversations resumed for reviews and rebuttals. No simulated seats or substituted rebuttal authors.

**Evidence packet SHA-256:** `e5f76fbc0b22d2150cd3b29a36007a725f66e6b86123d020a724400181d0c55e`.

### Options and initial proposals

| Option | Assessment |
| --- | --- |
| A: recover exact fixed refusal from known safe recordings | Lowest-change discriminator, but the known source was exhausted; no broad search or replay authorized |
| B: two existing route-guard codes | Selected; bounded diagnostic value with unchanged behavior |
| C: broader continuation/state instrumentation | Deferred; unnecessary scope and privacy surface without discriminating evidence |
| Permanent state/ownership repair | Not selected; root cause unverified |

| Anonymous label | Advisor lens | Independent initial recommendation |
| --- | --- | --- |
| A | Systems architecture | Known-safe-wording check, then narrow B; defer broader repair |
| B | Quality and verification | Narrow B, with known-recording check only and explicit test matrix |
| C | Reliability and security | Known-safe-wording check, then B with privacy/capture controls |
| D | Implementation | Known-safe-wording check, then B with minimal compatibility impact |
| E | Alternative designer | Known-safe-wording check, then B; challenge unsupported causal assumptions |

The label mapping was randomized and author identities/roles were withheld while each of the five original advisors reviewed all five anonymized proposals. The mapping is disclosed here only after review. Anonymous review packet SHA-256: `17df4b58b74c8650ec6eab38359b67435e0e67ecb8e4ceb37692114b34330ff4`.

### Five anonymous reviews

| Reviewer lens, disclosed after review | Review finding |
| --- | --- |
| Systems architecture | Preferred B's verification with C's privacy constraints |
| Implementation | Preferred B/C combination; challenged the async-manager causal claim |
| Reliability and security | Preferred B; challenged unbounded searching and retries |
| Quality and verification | Preferred C's privacy controls plus B's test matrix |
| Alternative designer | Preferred B/C; required attributable capture |

The EDO did not decide by vote. Shared assumptions were challenged against code and capture limitations.

### Owner-led objections and all-five rebuttals

1. **Async causal claim:** Baseline `session-manager.ts` declares `continue` async near line 502; the route invokes it without awaiting near lines 242–248, then emits the receipt near lines 250–252. An ordinary async rejection cannot suppress that following synchronous receipt. All five advisors accepted or corrected their earlier overbroad manager hypothesis. **EDO disposition: accepted correction.** Missing receipt evidence remains conditional on complete capture and matching runtime.
2. **Known-recording alternative:** BA confirmed that the identified safe recording could not recover the exact refusal. All five accepted narrow B without broad hunting or C. **EDO disposition: A exhausted; B accepted; C and permanent repair deferred.**
3. **Offline versus live execution:** All five accepted separate gates. Strict first-refusal cancellation was not intrinsically required for the Read-only fixture. **EDO disposition: accept enforceable wall-time/spend/owned-termination controls and observed attempt counts; reject an asserted exact request-count ceiling without a verified enforcement mechanism.** BA clarified that built-in CLI retries were not prohibited; added retries/manual replay remain excluded.

All five original advisors completed rebuttals. No remaining dissent on the offline scope; root-cause uncertainty and unproven live controls remain explicit. This record is a technical recommendation within existing user authority, not new human approval.

## Pinned instruction receipts and adaptations

Core task repositories were verified at their current default-branch HEAD before phase work; applicable instructions were read in full. Digests below refer to retrieved checkout bytes.

| Source | Pinned commit | Applied path/method |
| --- | --- | --- |
| obra/superpowers | `2ce8aa15d05bd57213e6f746f953aafb7ded7a8b` | Debugging/tracing, TDD/good-tests, writing-plans, verification |
| EmpRider/claude-skills-llm-council | `a7565e21d5ab03551fe66e36818e05af245467b8` | Root `SKILL.md`; five-advisor review and EDO discussion |
| JuliusBrussee/caveman | `9b68f7ed12b05e7efaff18e65c5a3fc2849fd0a4` | `skills/ultracave/SKILL.md`; internal communication |
| DietrichGebert/ponytail | `96608e078b2d5ea607c5c3b8b5a54d1c1fba6846` | `skills/ponytail/SKILL.md`; ultra for technical contributors |
| ayghri/i-have-adhd | `1ecea1993b7fce257ffbd686c070948b5e07eda6` | BA communication |
| alexgreensh/attention-span | `39c6b46b24dddecc4cef4e3ab8dc36d3fbffeb42` | BA decision/status output styles |
| BuilderIO/skills | `f1e12a1b75f342e0b49ebaf182b05168f4fa7b96` | `skills/agent-watchdog/SKILL.md`; audit/compare-only |

Key SHA-256 receipts:

- Council: `0ca930225ad0225804d36f14ad097fa79c80fe4abc640f3c879c89eccc2a610b`; raw Git LF form `6387755b0cd0f069720549c7e81d90b724433d4ff46cb127271b902939ad586d`, with CRLF-only equivalence verified.
- Debugging: `51c6435d98c83c42c96ba7c35725a0b2c376cd487fb1a4e6bd0ddbe7e33ef202`; tracing: `75b933b6a8c40bdb2031b10f21654395b56ec6ab6bc7b018c18d3fe57aeb7fb8`.
- TDD: `64b03fce4aee5a97a93160cea8111f3ba13a17b7c001db4bd5836d67fd10705d`; good-tests: `51471c853306ff92ca8bb41dcaea05f31c0e46b03651f8f3c99754b7172f4ae1`.
- Verification: `2befe7fc55bcadaa3d97dd9e8efeb633d2561c0ebe74c5a8b17c4d9e7e4520b3`; writing-plans: `a6c67c1900064347c2a329990dd3c555657c51c3ec53b259a08aa01a2c26139a`.
- Ponytail ultra: `f18008471528f0adde90a560d053f85935eed5cee26c447b7177ad24472bcf32`; Caveman ultracave: `a8da5b0b3501b853e1b98f2ae09fe8dc9c0edf481b1d3fa9529f8557011c1ef8`.
- Watchdog: `cbcf5459c6aa465c070f35bb4a7b4f97f9674d19e114ac449eee87aa7c29e1ac`.

Adaptations: use the existing authorized tracker instead of a second plan system; no automatic commits/worktrees/installs; retain the mandatory highest requested model; keep BA as the only user interface; Watchdog never repairs. Persisted records use plain prose rather than compressed internal style.

## Publication, completion, and rollback

PM must verify the expected feature-branch head, exact two-file staged ledger candidate, privacy, tracker validity, committed tree, and actual remote head before TL releases implementation. Initial source baseline: `7dc08019e0730b7b31e304e8e269fd57d445f67f`.

The manifest's `work_status`, `scope_status`, `delivery_status`, and `status_sync` distinguish implementation readiness, scope, source-code delivery, and status publication. `NOT_PUBLISHED` concerns the implementation, not the existence of this ledger. Tracker status transitions use `taskctl.mjs`; existing task records must remain unchanged. Publication commit references are verified externally because a commit cannot contain its own SHA.

This branch's ordinary push does not prove CI: the inspected workflow triggers on main pushes and pull requests. Branch-protection requirements are not exposed by Git CLI. No CI, merge, release, or user acceptance is claimed.

Rollback is limited to reversing this task's diagnostic/test changes while preserving unrelated work. No reset, history rewrite, migration, configuration/data change, or cleanup is authorized. Later source publication and its rollback require separate authority.

Kickoff state: Council and three-specialist gates complete; ledger publication pending verification; offline implementation not yet started; tests not yet run; live E2E waiting on its separate controls; permanent defect repair unresolved.

### Verified publication and execution checkpoint

Initial ledger commit `c247d85f141732f06e3245c5cc98bae257fd2c09` was pushed and verified at the exact remote feature-branch head. Its tree `77873ac215ad215720419cfe95bf32f325ef7adf` matches the verified two-file candidate. Tracker validation passed with 8 epics and 50 tasks; all 49 pre-existing records remained unchanged. Privacy/digest and staged whitespace checks passed after correcting two source-receipt transcription errors before publication. No source code was included.

TL independently rechecked the clean published baseline and pre-edit audit, then released S4's exclusive six-file offline package. The original implementation agent is observed running. This is an execution-start checkpoint, not evidence that code, tests, live E2E, or a permanent fix are complete. The initial ledger publication is confirmed; implementation delivery remains `NOT_PUBLISHED`. The follow-up status commit is verified externally rather than self-referenced here.
