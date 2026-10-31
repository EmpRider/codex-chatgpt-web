# Upstream integration — 2026-10-31

Request: "check that and get new updates changes to our repo". User owns real-world acceptance. Companion to manifest.json in this backup directory; supersedes nothing.

Source: https://github.com/miuuyy/codex-chatgpt-web.git main, pinned 860fa57 (v6.1.17). Merge base cfeaf04; 23 commits; 92 changed paths.
Local HEAD remains cb346e5. No commits, history merges, staging, push, release, installer, or operator configuration changes.

Preservation: before/ contains byte-for-byte copies of all upstream target files that existed and all 20 prior dirty/untracked files. local-before.patch records tracked local changes; upstream.patch records the source delta; manifest.json pins full hashes and paths. Nineteen dirty files not touched by upstream verified byte-identical after integration. turn-broker.ts includes both prior recovery/diagnostics and upstream Full Access validation change.

Ruling: import upstream source changes without a history merge because commit authority is absent. Consequence: upstream ancestry is not recorded until an authorized Git integration later.
Ruling: normalize CRLF to LF in candidate inputs for three-way comparison; preserve original bytes in backup. Initial CRLF conflicts were artificial.

Four actual conflicts reconciled:
- TROUBLESHOOTING.md: retain fork 9Router guidance and upstream Bigger Context guidance.
- launcher/electron/main.cjs: retain agentResponsesPort and its IPC channel alongside useTemporaryChats and upstream session-reminder changes.
- launcher/tests/runtime-host.test.cjs: upstream parameterized settings test retains fork's test-context argument for isolated fixtures.
- src/adapters/chatgpt-web/prompt.ts: retain shared native/external planner and JSON renderer; incorporate upstream shared resume and multipart compaction transport ceiling; remove duplicate inner declarations.

Verification so far: root typecheck PASS; launcher typecheck PASS; git diff --check PASS (CRLF warnings only). HEAD/index preservation PASS.
Version check BLOCKED: repository pins Bun 1.4.0; installed Bun 1.4.4. No runtime installation or pin edits attempted.
Full suites completed: root 1239 passed / 110 skipped / 0 failed (110 files, 189.64s); launcher 432 passed / 6 skipped / 0 failed. Both commands exit 0. Logs: root-tests.log and launcher-tests.log. The post-test Python console summary hit Windows cp1252 encoding failure; actual saved test logs were read separately to verify counts. Independent read-only integration review still running against the actual parent checkout.
