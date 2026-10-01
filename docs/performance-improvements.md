# Request latency and memory improvements

This change targets local overhead in v6.2.5. It does not change model reasoning time or the
remote ChatGPT service. No Windows working-set measurement has been collected yet.

## Changes

- Token estimates reuse exact text within the owning asynchronous request. Each cache retains
  at most 128 entries and 8 MiB of conservatively charged string data. Daemon and browser-helper
  processes each establish their own scope; concurrent requests do not share prompt caches.
- MCP context batches reuse Unicode-safe chunk offsets and slice only the requested range.
  Transport identifiers, hashes, batch limits, and the complete context remain unchanged.
- Response-history snapshots use asynchronous atomic writes and yield between serialization
  batches. They serialize each eligible entry once, skip oversized entries before serializing
  them again, and coalesce obsolete pending snapshots while the disk is busy. Graceful shutdown
  awaits persistence. Snapshot limits count UTF-8 bytes; live-state accounting conservatively
  charges UTF-16 strings. One oversized latest continuation remains available in memory, so the
  64 MiB cache target is a soft accounting limit, not a hard process-memory ceiling.
- Automatic completed browser tabs expire after five idle minutes instead of thirty. Subsequent
  automatic requests can prepare the full context when no retained tab is available. Manual
  conversations retain their thirty-minute period. Running turns keep their existing heartbeat
  and suspension protection.
- Browser response mutations wake observation without the unconditional 250 ms sleep. A 50 ms
  minimum coalesces bursts; the existing 250 ms fallback still checks CSS and external state.
  Temporary observers and timers are disconnected on settlement.
- Launcher logs use bounded asynchronous batches. MCP lifecycle logs also batch on macOS and Linux. Launcher logging flushes on
  export and graceful quit; lifecycle logging flushes on server and browser-helper shutdown and normal process exit.
  Windows lifecycle diagnostics preserve the previous immediate synchronous writer while
  Bun 1.4.0 named-pipe teardown compatibility is investigated.
  Redaction and rotation remain enabled. Under a stalled disk, bounded logging queues can discard
  old pending records rather than accumulating RAM indefinitely; launcher logs report this loss.
- Headroom failures open a thirty-second cooldown scoped to configuration directory and port.
  During cooldown, original content passes through. After cooldown, one recovery probe is allowed
  at a time. The existing three-second request deadline remains in place.

## Measurements

Run `bun scripts/benchmark-performance.ts` with the pinned Bun 1.4.0 runtime.

The local repeated-count benchmark for eight identical 500,000-character inputs measured
663.1 ms without a request cache and 78.5 ms with it: about 8.4 times faster for this operation.
The cache recorded one miss and seven hits. This is an algorithm benchmark, not an end-to-end
ChatGPT latency promise.

Selecting all five-chunk batches from an 8 MiB MCP payload measured 0.97 ms with an all-chunk
slicing replay versus 0.012 ms with cached offsets and direct range slicing. The absolute saving
is small relative to network and model time.

## Verification and remaining checks

Regression coverage includes async request-cache isolation and eviction, Unicode chunk boundaries,
snapshot yielding and concurrent flushes, replay after a process restart, snapshot byte limits,
log flushing and rotation, Headroom recovery, and retained browser ownership. Existing prompt,
multipart, compaction, browser-contract, and launcher checks are also exercised.

The runtime bundle and launcher renderer build must pass before handoff. This host rejects socket
listeners with EPERM, so live broker/server integration cannot be established here. Its process
view also prevents an existing Linux AppImage packaging test from reading its own `/proc` record.
Qodo CLI review is unavailable in this environment.

Before release, run the broker/server integration suite in CI and measure Windows RAM after idle
tab reclamation, plus time to prompt submission and first response delta with representative
small, large, and image-heavy requests. Startup snapshot loading and initial live-state weight
calculation still use synchronous parsing/serialization; those are remaining profiling targets.
