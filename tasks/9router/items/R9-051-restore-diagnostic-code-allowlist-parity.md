# R9-051 — Diagnostic-code allowlist parity implementation plan

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Status and evidence:** [manifest.json](../manifest.json) is authoritative.
- **Dependency:** R9-035, verified done.
- **Related task:** [R9-050](R9-050-expose-safe-tool-result-continuation-conflict-causes.md); source ownership is serialized, not a claim that R9-050 is published or complete.

**Goal:** Restore acceptance of the already defined fixed diagnostic code `tool_schema_total_limit` in the existing Activity allowlist and add a focused regression.

**Architecture:** One existing literal is missing from the closed consumer vocabulary. Add that literal only; preserve the typed producer, unchanged route forwarding, and existing factory/validator/observer pipeline.

**Tech stack:** Existing TypeScript Activity module and Bun tests; no dependency or new interface.

**Spec:** Council CW409-C2 approved this narrowly related, proven pre-existing mismatch under the BA-recorded user instruction to permanently fix discovered actual issues. This is not blanket authorization for unrelated cleanup, source publication, or a change to continuation behavior.

## Evidence and scope boundary

Before any R9-050 code/test edit, the baseline typecheck failed with `TS2322` at `src/integrations/agent-responses/routes.ts:303`: the existing diagnostic-code union contains `tool_schema_total_limit`, while Activity `CODES` omits it. The existing request regression at `tests/agent-responses-request.test.ts:98` expects that code; the unchanged route forwards the typed diagnostic code at lines 300–303.

R9-050 adds only two continuation-refusal codes and does not introduce this mismatch. Independent C1 QA passed its scope and quality review: 82 Bun tests, 678 assertions across eight files, and nine launcher tests passed. The remaining typecheck failure was exactly the inherited single `TS2322`, not a C1 regression. Six C1 source/test postimages remained unchanged during QA. Historical RED evidence was reported by the implementer, not independently rerun by QA.

This task corrects the bounded allowlist mismatch. It does not identify or repair the original HTTP 409 continuation root cause, change request routing, or prove live E2E success.

## Authority, ownership, and prerequisites

- PM is the sole ledger author and Git publication coordinator; only this ledger may be committed/pushed under current authority.
- S4 is the sole implementation writer; S3 independently reviews and verifies.
- The C1 candidate is frozen and its independent QA checkpoint has passed. S4 must not add the third literal until PM verifies this task's ledger on the actual remote branch and TL releases the bounded package.
- Both tasks touch Activity files, so there are no concurrent source writers. Preserve C1 and unrelated user changes exactly.
- Source-code commits/pushes, merges, deployment, installs, live probes, and broad refactoring remain unauthorized.

## Global constraints and review focus

1. Add only the already defined `tool_schema_total_limit` literal to the existing `CODES` allowlist; do not relax unknown-code validation or refactor enum ownership.
2. Preserve existing event fields, numeric status, producer behavior, route forwarding, privacy, retention, and delivery behavior.
3. Verify a positive event and exactly one observer delivery before interpreting canary absence; avoid a vacuous passing test.
4. Forbidden-field payloads and unknown-code canaries must be rejected with no delivery, not silently stripped.
5. Existing category visibility is restored; do not add a new rate policy, fields, helpers, stores, or general cleanup.

## Bounded implementation plan

**Only production path:** `src/activity-events.ts`, one fixed literal in `CODES`.

**Only test path:** `tests/activity-events.test.ts`, the minimal regression through the existing factory, validator, and observer/sink helpers.

**Existing interfaces:** Consume the existing typed diagnostic code and Activity event APIs already used in this test file. Introduce no signature, event, field, helper, or public API.

- [ ] Confirm C1 QA, remote ledger verification, and TL's exclusive S4 handoff before the first R9-051 source edit.
- [ ] Add a positive factory/observer regression for `tool_schema_total_limit` with status `413`; require a non-null event, exact code/status, validator roundtrip, exactly one observer delivery, and the serialized code.
- [ ] Add negative assertions proving forbidden fields and unknown codes are rejected with no observer delivery; keep unique canaries absent from serialized output.
- [ ] Run the focused positive regression against the missing-literal behavior and record the intended RED. The failure must demonstrate the missing allowlist membership, not a fixture or syntax problem.
- [ ] Add the one existing literal to `CODES`; make no other production change.
- [ ] Rerun the regression GREEN, existing request/gateway tests, assembled C1+C2 typecheck, and launcher logging regressions.
- [ ] Have S3 independently review the complete candidate and verify the exact two-path C2 scope while preserving C1.
- [ ] Stop for TL/Council reassessment if this literal and bounded regression do not resolve the demonstrated mismatch.
- [ ] Keep source publication separate. Do not mark this task done based only on local code/tests.

Verification commands, planned rather than already completed for C2:

```text
bun test ./tests/activity-events.test.ts ./tests/agent-responses-request.test.ts ./tests/agent-responses-gateway-contract.test.ts
bun run typecheck
node --test launcher/tests/logging.test.cjs
```

Use only isolated disposable fixtures and existing supported runners. No dependency installs, network audit/download commands, live provider aggregate-schema probe, or application restart is required. Any separately authorized later application launch remains exactly `bun run app`; Claude Code E2E still requires `--model haiku`.

## Council CW409-C2 record

**Decision:** Approve the narrow offline literal restoration and bounded regression, conditional on C1 independent QA and remotely verified R9-051 ledger before source edits.

**EDO and order:** The assumed TL decision owner recorded a private provisional preference at 2026-11-01 12:36:15 UTC before advisor proposals. The preference favored restoring the existing literal; final preference stayed unchanged, with verification and authority constraints clarified. No human approval was impersonated.

**Evidence brief SHA-256:** `1fe48506c719cc98048096cc997462a3f8e0a85bbcf2a0694188285f6a342f25`.

**Independent agents:** Five real fresh advisors, each explicitly requested as `gpt-6-astra` with `ultra` effort and a fresh context. Effective execution settings were `NOT_EXPOSED`. All received the same neutral brief plus their lens, without prior proposals or the EDO preference.

| Anonymous label | Lens, disclosed after review | Independent proposal |
| --- | --- | --- |
| A | Quality and verification | Option 2: restore the existing literal with bounded proof |
| B | Systems architecture | Option 2: restore the existing literal without structural refactoring |
| C | Implementation | Option 2: the one-literal correction and minimal regression |
| D | Alternative designer | Option 2, constrained to the demonstrated mismatch |
| E | Reliability and security | Option 2 with strict privacy/rejection assertions |

Option 1 left a proven type/consumer mismatch unresolved. Option 2 is the selected literal restoration. Broader enum refactoring, validation relaxation, new fields/helpers, unrelated cleanup, and source publication were rejected.

All five original advisors reviewed all five anonymized proposals and then answered EDO objections in their existing conversations. Anonymous packet SHA-256: `5b6e8adb3b430970347a34cb5566445d95712ef944945bdceea1f1131bab89cd`. Each review retained the narrow correction; the EDO resolved the substantive issues below rather than using a vote.

### Discussion and dispositions

- **Authority:** Advisors challenged treating a generic approval phrase as blanket permission. **Accepted clarification:** BA confirmed the user's instruction to permanently fix discovered actual issues, interpreted narrowly for this related, proven mismatch. No unrelated authority or source-publication permission follows.
- **End-to-end aggregate-schema capture:** Quality and architecture initially favored a real-provider capture. **Resolved as optional:** the existing request regression, inspected unchanged typed route forwarder, and new factory/validator/observer sink chain cover this exact defect. No new live probe is required.
- **Privacy test strength:** Reliability required forbidden fields to cause rejection/no delivery, not merely stripping. **Accepted:** pair negative canaries with a positive, exactly-once delivery assertion.
- **Volume and scope:** The alternative lens raised category-volume concerns. **Accepted boundary:** restore visibility of an existing category only; no new rate policy or generalized diagnostics change.

All five original advisors completed rebuttals and accepted the final constraints. No remaining dissent on the bounded correction. This verdict does not claim the continuation defect is fixed.

## Source receipts, publication, and rollback

Reuse the verified task-pinned instructions and corrected digests in the [R9-050 source receipt](R9-050-expose-safe-tool-result-continuation-conflict-causes.md#pinned-instruction-receipts-and-adaptations). The same debugging, TDD, verification, Ponytail ultra, Caveman ultracave, and independent-audit boundaries apply. The completed Council is a technical gate, not permission to publish source code.

PM stages only `tasks/9router/manifest.json` and this new specification, validates the tracker and privacy-safe contents, verifies that the staged/committed tree excludes all six in-progress C1 source/test paths, and checks the exact remote head before releasing the ledger gate. The source working diff remains uncommitted. Record publication and later status-sync commits separately.

Rollback is a scoped reversal of only R9-051's literal/test hunks by the same writer while preserving C1 and user changes. No reset, history rewrite, migration, or data/configuration change is authorized.

Kickoff: C2 Council complete; C1 independent QA passed; R9-051 code/tests not yet started; remote ledger verification pending; source-code delivery and original HTTP 409 repair remain incomplete.
