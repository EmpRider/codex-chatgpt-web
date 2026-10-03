# Reliable Turns and Preparation Implementation Plan

> Execute inline with regression tests before each production change.

**Goal:** Begin the approved optimization program with compatible native-wait fixes and bounded reusable computations.
**Architecture:** Keep the native/MCP protocol intact. Distinct returned results renew an inactivity deadline within a hard batch cap; long terminal polls yield before MCP expiry. Reuse deterministic computations with bounded caches, without retaining conversation text globally.
**Tech stack:** TypeScript, Bun 1.4.0, existing AJV and Playwright infrastructure.
**Spec:** [Approved report](2026-10-02-approved-optimization-report.md).

## Constraints

- Preserve advertised tools, approval fields, capability and completion fencing.
- No automatic retry of unknown side effects; no heartbeat-based watchdog renewal.
- No Codex client changes, merge or release in this implementation stage.
- Bound caches; preserve Windows compatibility and current cold-path behavior.

## Tasks

- [x] Verify isolated branch and baseline native deadline/cache/strict-output tests.
- [x] Reproduce partial-result deadline expiry; renew on distinct results only, cap total batch life at twice the inactivity allowance, and expose unresolved/completed counts and elapsed time in diagnostics.
- [x] Reproduce overly long write_stdin polls; clamp only observation yield to a transport-safe budget while preserving session ID and input bytes. Keep process execution alive for later polls.
- [x] Add cross-request token reuse keyed by exact-content digest, bounded entries and expiry, retaining no prompt text globally. Preserve request-local counters and release.
- [x] Cache strict schema validators by serialized schema under entry/byte caps, preserving format names and schema mutation behavior.
- [x] Remove unnecessary model-family menu reopen only when fresh closed-label evidence proves the requested family; retain fallback verification for ambiguous labels.
- [x] Add bounded background prepared-history reuse, fresh suffix validation, mutation isolation, ancestry reuse and per-call metadata indexing.
- [x] Run relevant suites, typecheck and full regression; document limitations and outstanding report items.

## Review focus

- Invalid/duplicate results must not extend the deadline or corrupt batch state.
- Heartbeats and reconnect touches cannot conceal a deadlocked batch.
- Cached computations must not freeze mutable schemas or retain private prompt text.
- Long polling changes must not truncate command execution or input characters.
- Ambiguous Pro labels require fresh family evidence; a label change must block submission.

## Deferred work

The remaining approved report stays open: durable cross-process result reconciliation, generic asynchronous jobs, shared raw-history storage and incremental size accounting, shared environment persistence, deeper prompt fragments, diagnostics capture redesign, observer refinement and background concurrency. Implement after this compatible foundation and its tests; do not claim these complete.
