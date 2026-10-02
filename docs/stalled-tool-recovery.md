# Stalled native tool recovery

Included in v6.2.7. If an older task is already stuck, stop it and restart the
launcher after upgrading to clear the old browser session. Check Codex for the
native command outcome before resubmitting the task.

Automatic mode now bounds three waits that previously could keep an accepted
browser turn open indefinitely:

- Browser acknowledgement of a pulled native tool batch: 30 seconds. No native
  call from that batch is emitted before its browser boundary is acknowledged.
  A missing acknowledgement returns `browser_tool_boundary_timeout`.
- Native results after batch emission: 150 seconds, allowing the MCP transport's
  90-second deadline plus one minute for a delayed continuation. Missing results
  return `codex_tool_result_timeout`. The native outcome remains unknown; the
  bridge does not automatically replay the operation.
- Structured compaction: twice its inactivity budget, at most ten minutes.
  Browser heartbeats can renew inactivity but cannot renew this total deadline.

A configured shorter turn timeout also limits tool waits. The native-result
watchdog applies to automatic mode; manual Zero Risk retains its user-controlled
lifecycle. Completed batches clear their timer. Logical timeout responses do not
release physical ownership early: a replacement still waits for helper cleanup.

Privacy-safe lifecycle exports distinguish `tool_boundary_wait`,
`tool_boundary_observed`, `tool_boundary_timeout`, `native_batch_emitted`,
`native_result_received`, and `native_result_timeout` using the existing trace
identity. They contain no command arguments, file paths, or file contents.

These guards prevent silent indefinite waiting and make the blocked boundary
observable. They do not establish why a native process failed to return a
particular file read. A tool result received after its failed turn has retired
cannot be treated as a new successful operation; inspect Codex before retrying.
