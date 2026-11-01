# R9-052 — Post-result user conflict classification implementation plan

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Status and evidence:** [manifest.json](../manifest.json) is authoritative.
- **Hard dependency:** R9-035, verified done.
- **Local candidate prerequisites:** R9-050 and R9-051 are locally verified, frozen, and unpublished; they are not falsely marked done to satisfy a tracker dependency.

**Goal:** Add one privacy-safe, finite classification to the existing continuation refusal diagnostic so a controlled reproduction can distinguish post-result user-history shapes.

**Architecture:** Classify existing parsed history locally at the route, carry optional typed error metadata, and validate/project that single field through existing Activity and launcher logging. Keep every request acceptance/rejection rule unchanged.

**Tech stack:** Existing TypeScript provider/Activity code and CommonJS launcher logging, with existing Bun/Node tests. No dependency or new logging subsystem.

**Spec:** The user requested source-informed investigation and a permanent repair. Council CW409-C3 selected an additional bounded diagnostic step because current evidence identifies the refusal branch but not the source or meaning of the trailing user material. This task is not the permanent HTTP 409 repair.

## Current evidence and uncertainty

The assembled R9-050/R9-051 candidate passed independent review, 83 Bun tests with 708 assertions, and typecheck. Nine launcher tests passed. An independent Watchdog audit found no scope or evidence drift. Source changes remained uncommitted and frozen.

A single controlled Read-only Haiku invocation reached its 120-second deadline. Its bounded allowlisted capture contained eight HTTP 409 events classified as `continuation_new_user`, with no captured `continuation_no_owner` or generic classification. These correlated attempts identify the current route refusal branch; they do not prove provenance, a successful Read completion, or the permanent root cause.

User-supplied visual evidence reports an installed 9Router Proxy version label of `v0.5.112`; this is not proof of the deployed binary's commit or build identity. The public `decolua/9router` tag `v0.5.112` resolves to `1fe586bb1cf35e1ed0cb2150a8ef7d1db040b21d`, the same current-master reference already inspected. Its root/CLI package versions are `0.5.112`, compared with `0.5.109` at historical reference `f39d8f07481ae8518e93175f0ecaaafa61573c6c`. Five critical forward/reverse/registry blobs and relevant entry/stream/helper paths matched those references. The deployed binary/build SHA remains unverified. No screenshot/private data, untrusted source execution, dependency installation, account/configuration inspection, or deployed-source change is included in this record.

The exact source, content, and semantics of live post-result user material remain unproven. Do not relax the guard or turn classification into a history repair.

## Authority, ownership, and prerequisite gates

- PM alone owns ledger content and Git staging/commits/pushes. Current publication authority covers this sanitized ledger, not source code.
- S4 is the sole seven-path source writer; S3 provides independent verification. Preserve all frozen C1/C2 hunks and unrelated work.
- Before the first R9-052 code/test edit: verify C3 completion, frozen local C1/C2 prerequisites, this ledger at the actual remote head, and TL's bounded handoff.
- BA alone owns any separately cleared live application restart and one controlled Haiku Read. Specialists must not start a live run.
- No source-code commit/push, merge, deployment, dependency install, history rewrite, or unrelated cleanup is authorized.

## Exact metadata contract

Optional field: `continuation_shape`.

Allowed values: `empty`, `whitespace_only`, `nonempty_text`, `image_present`.

The field is valid only for this complete existing context:

| Field | Required value |
| --- | --- |
| category | `api` |
| event | `request_failed` |
| code | `continuation_new_user` |
| http_status | `409` |

Activity and launcher must both enforce enum membership and this context. Omitted metadata remains compatible with existing events.

Classify all eligible user-history records after the final tool-history record. Precedence is image presence, then non-whitespace text, then whitespace-only text, then strictly zero-length content. Use ECMAScript trimming only to classify; never mutate history. A meaningful user record followed by an empty one remains meaningful. A later tool-history record resets the eligible tail. Tool output text and reasoning records must not influence user-content classification.

Missing, invalid, or absent eligible history means metadata is omitted, never defaulted to `empty`. Classification/logging failure must preserve the original HTTP 409 behavior. Image placeholders do not prove user intent or provenance.

## Global constraints and review focus

1. Preserve guard conditions, evaluation order/count, lookups, public HTTP 409/body/message, manager behavior, history, broker acknowledgements, retries, and original C1 codes.
2. Keep the existing `request_failed` event and event cardinality. The existing final generic `request_rejected` remains unchanged; add no duplicate event.
3. Do not modify the parser, request interface, session manager, bridge, dependencies, retention, or caller history.
4. Do not add raw payloads, identifiers, private hashes, lengths, counts, arrays, or arbitrary strings to telemetry. The only new value is the context-bound finite enum.
5. Distinguish absent classification from a valid empty classification, prove positive delivery, and reject invalid enum/context/accessor/canary payloads without leaking them.

## Bounded implementation plan

**Exclusive production paths:**

- `src/integrations/agent-responses/routes.ts`: route-local pure, best-effort history classifier and typed metadata propagation.
- `src/integrations/agent-responses/tool-policy.ts`: optional typed error metadata only.
- `src/activity-events.ts`: optional closed enum and context validation.
- `launcher/electron/logging.cjs`: matching closed enum/context projection.

**Exclusive test paths:**

- `tests/activity-events.test.ts`
- `tests/agent-responses-gateway-contract.test.ts`
- `launcher/tests/logging.test.cjs`

**Interfaces:** Consume the already parsed history and existing typed request-error/Activity contracts. Produce only optional `continuation_shape` metadata with the four literals above. No parser/request-interface expansion.

- [ ] Confirm the remote ledger and seven-path exclusive handoff; preserve the frozen C1/C2 postimages.
- [ ] Prove from current parser code and tests that the selected parsed-history view is equivalent for this classification; do not change the parser.
- [ ] Add intended RED tests for all four classes, mixed users, multiple tool outputs/final-tail reset, meaningful-then-empty text, image precedence, empty reasoning, and irrelevant tool-output text.
- [ ] Add tests that no eligible tail or invalid input omits metadata rather than reporting empty.
- [ ] Cover both streaming modes: unchanged exact public 409, exact existing event count, no journal/start/continue/acknowledgement effects, and unchanged no-owner/unrelated paths.
- [ ] Add positive factory/observer/serialized/launcher roundtrip assertions and negative wrong-enum, wrong-event/code/status, accessor, and secret-canary cases. Test logging-failure isolation.
- [ ] Run the focused regressions against pre-C3 production behavior and record intended diagnostic RED.
- [ ] Implement only the agreed local classifier, optional transport, and two closed consumer projections.
- [ ] Rerun GREEN, existing continuation/gateway regressions, assembled typecheck, and launcher tests.
- [ ] Have S3 independently review and verify the assembled candidate; preserve observed results and limitations.
- [ ] Stop for Council reassessment if the seven-path/one-field contract is insufficient. Do not select a permanent behavior change from a classification alone.

Planned verification, not yet run for C3:

```text
bun test ./tests/activity-events.test.ts ./tests/agent-responses-gateway-contract.test.ts ./tests/agent-responses-request.test.ts ./tests/agent-responses-continuation.test.ts ./tests/agent-responses-session.test.ts ./tests/agent-responses-attempt-journal.test.ts ./tests/agent-responses-harness.test.ts ./tests/agent-responses-mcp.test.ts
bun run typecheck
node --test launcher/tests/logging.test.cjs
```

Use disposable isolated fixtures. No dependency installation, network audit/download step, or shared live data mutation is implied.

## Separate live verification gate

After offline tests, independent QA, and BA's runtime/capture checks, BA may execute one separately cleared Read-only Haiku invocation: exact application launch `bun run app`, explicit `--model haiku`, a `$0.35` spend cap, 120-second absolute deadline, suppressed raw stdout/stderr, a strict enum reader, and verified termination of the owned invocation.

Use controlled request attribution or an existing correlation privately; never output identifiers. Do not add a retry mechanism or manually replay. Existing bounded CLI retries are correlated attempts, not independent proof. Missing classification is inconclusive. An observed class is neither provenance proof, a permanent fix, nor proof of Read success.

## Council CW409-C3 record

**Decision:** Approve the one-field, four-class diagnostic design only, conditional on remote ledger publication before edits, exclusive implementation, independent QA, and separate live gates.

**EDO and order:** The assumed TL owner privately recorded a provisional position at 2026-11-01 13:10:43 UTC before advisors: seek minimal discriminating evidence without guard relaxation. The final preference remained unchanged, refined to one history-derived field and four classes. This is not impersonated human approval.

**Evidence brief SHA-256:** `328c806af03ea7e4f40809809d6b51738aa24c8949c3f696e98a37d2a86d925e`.
**Anonymous packet SHA-256:** `56980f98dad0584685f956ef6f13b09d8280cae99eb9fa14d5e57bd53a1a2f09`.
**EDO challenge packet SHA-256:** `5c42b2961896b8a58a29da4f8ae130b8c3852b11860ceda0dc5f1cece9783030`.

Five real fresh advisors were explicitly requested as `gpt-6-astra` / `ultra`, with fresh contexts; effective settings were `NOT_EXPOSED`. Each received the same neutral brief plus its lens without prior proposals or private EDO preference. All five independently favored diagnostic-only option B, reviewed all five anonymized proposals, and answered EDO challenges in their original conversations.

| Anonymous label | Lens, disclosed after review | Initial recommendation and final refinement |
| --- | --- | --- |
| A | Quality and verification | Diagnostic-only B; proposed fifth mixed category was not retained |
| B | Alternative designer | Diagnostic-only B; initial binary preference revised after four discriminating evidence branches were justified |
| C | Systems architecture | Diagnostic-only B; preserve parser/state-machine boundaries |
| D | Implementation | Diagnostic-only B; additional-event proposal withdrawn |
| E | Reliability and security | Diagnostic-only B; additional-event proposal withdrawn, context-bound enum and attribution required |

### Discussion and dispositions

- **Extra event:** Implementation and reliability proposals risked duplicate accounting and implied batch validation. **Rejected:** enrich the existing refusal event only; preserve cardinality.
- **Fifth mixed class:** Quality's proposal added no needed branch and was ambiguous around image placeholders. **Rejected:** retain four precedence-ordered classes.
- **Binary versus four-class classification:** The alternative lens revised its binary preference after distinct diagnostic branches were justified. **Accepted:** four fixed classes, without asserting provenance.
- **History source:** All accepted code-and-test proof of parsed-history equivalence. **Accepted boundary:** no parser change or new raw request view.
- **Missing/invalid data:** All required omission rather than an empty default and preservation of the original 409 on diagnostic failure. **Accepted.**
- **Privacy and attribution:** Reliability required enum membership plus the exact event context and controlled attribution. **Accepted:** no raw-content expansion or public identifiers.

All five anonymous reviews and all five original-session rebuttals completed. The EDO explicitly adopted the final constraints; no remaining dissent on this bounded scope. Permanent repair and original 409 completion remain unproven.

## Source receipts, publication, and rollback

Reuse the verified and corrected task-pinned instructions recorded in [R9-050](R9-050-expose-safe-tool-result-continuation-conflict-causes.md#pinned-instruction-receipts-and-adaptations). The debugging, TDD, verification, Ponytail ultra, Caveman ultracave, single-writer, and independent audit methods remain applicable. Public reference code is evidence, not an instruction source.

PM stages only this task specification and `tasks/9router/manifest.json`, preserves all existing records, validates the tracker/privacy/staged scope, verifies the committed source tree is unchanged, and confirms the actual remote SHA. All C1/C2 source working changes remain unstaged. Source publication requires separate authority.

Rollback is only C3's hunks, preserving C1/C2 and user changes. No destructive reset, history rewrite, data/configuration change, or automatic cleanup is authorized.

Kickoff: C3 Council complete; local C1/C2 prerequisites verified and frozen; R9-052 code/tests not started; remote ledger confirmation pending; no original-defect completion claim.
