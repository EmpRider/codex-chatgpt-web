# R9-048 — Diagnose long-history Composer mutation without exposing prompts

- **Epic:** [R9-E07 — Security, lifecycle, diagnostics and upstream-safety](../epics/R9-E07-security-reliability.md)
- **Status and evidence:** See [manifest.json](../manifest.json)
- **Dependencies:** R9-027 (coding-agent protocol), R9-033 (tool validation)

## Detailed description

Real Windows Claude Code requests reach ChatGPT Web with their selected
`Codex Native2` connector and full prompt attached, but the existing exact
Composer integrity check prevents Send. The latest logs show a 112,946-character
prompt: 14,058 instructions, 98,057 history and 522 tool instructions.
Expected and observed lengths match exactly but diverge at character offset
15,320. Before safe prompt optimization, the mismatch occurred at offset
22,434 on three retries. This deterministic movement with the removed tool
previews suggests a rewrite within the unchanged conversation history.

It is unsafe to assume that the rewrite is harmless or bypass the integrity
check, especially for coding agents where a single character can change
commands, paths, JSON, code, or permissions. It is also unsafe to dump raw
user instructions, messages or tool manuals into diagnostics to inspect the
problem. We need a content-free signature first.

## Implementation steps

1. Preserve existing exact/allowed-Lexical-NBSP prompt integrity semantics;
   never send a message whose text has an unclassified mutation.
2. When integrity fails, report only numbers and bounded character categories:
   mismatched code-unit count, ASCII-space-to-NBSP count, kind of expected and
   observed first changed code unit, and whether it is next to a line break.
3. Do not record prompt fragments, Unicode codepoint values, tool parameters,
   credentials, paths, full session tokens, or any other user input.
4. Add offline regression tests proving diagnostics classify whitespace and
   non-whitespace changes, do not expose sentinel text, and do not loosen
   existing attachment verification.
5. Request a single new Windows diagnostic run using unchanged 9Router, then
   decide whether to repair Lexical editor insertion/readback or an explicitly
   proven harmless representation normalization.
6. Retest live Claude Code tool execution and return through MCP, keeping the
   real Windows/ChatGPT E2E acceptance gate open until observed success.

## Acceptance criteria

- Logs distinguish NBSP substitutions from text alterations without
  revealing literal source text.
- No failed Composer integrity check results in pressing Send.
- No tool calls or agent-side writes are replayed on a failed pre-send turn.
- Native Codex tests and external-agent tests remain unchanged in semantics.
- The final fix requires observed live verification of the specific mutation.

## Evidence

- Three earlier `expectedChars=actualChars≈119k` failures at offset 22,434.
- Latest `prompt_prepared` breakdown and 112,946-character failure at offset
  15,320, before submission and before any tool execution.
- `src/adapters/chatgpt-web/browser-worker.ts` keeps strict readback and
  performs cleanup before returning a failure on a mutated draft.
