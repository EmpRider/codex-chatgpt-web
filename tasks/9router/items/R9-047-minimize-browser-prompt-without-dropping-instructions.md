# R9-047 — Minimize browser prompt without dropping caller instructions

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Status and evidence:** See [manifest.json](../manifest.json)
- **Dependencies:** R9-027 (agent protocol), R9-033 (tool validation boundary).
  The implementation also uses the complete broker inventory added under
  R9-046, whose real Windows E2E gate remains in progress.

## Detailed description

The authenticated Windows Claude Code request (17 tools, simple "hi how are you")
reached the `Codex Native2` browser Composer, but the prompt attachment failed
before Send with `ChatGPT composer did not preserve the complete prompt`.
Across three attempts the expected and observed lengths were approximately
119,742–119,954 characters and the first divergent code unit was at offset
22,434. The Composer was cleared on the intentional pre-send integrity
rollback and the provider returned HTTP 502. Earlier requests without agent
tools were accepted and completed. Therefore tool schemas, authentication,
plugin selection and 9Router's HTTP route are not the immediate failure.

This task reduces *our own* browser prompt wrapper, not the coding agent's
security-relevant instructions, user request, or conversation history. Claude
Code may supply long instructions and extensive tool manuals. The broker
already retains full descriptions and schemas behind `codex_tool_inventory`,
so repeating even their 400-character previews for every tool is unnecessary.
The caller may also supply the exact same instruction bytes as both the
Responses `instructions` field and a top-level system/developer history item.

## Implementation steps

1. Replace initial tool descriptions/previews with just advertised function
   names and a requirement to retrieve full manuals/schema via
   `codex_tool_inventory` before use; keep full broker tools untouched.
2. Shorten bridge-specific prose without weakening the connector identity,
   non-disclosure of turn token, tool choice, or agent-side execution rules.
3. Omit an *exact* duplicate of `instructions` in top-level system/developer
   history from the browser prompt, preserving original request history for
   later tool-continuation authorization. Do not dedupe similar-but-different
   strings or delete any user/assistant/tool message.
4. Add privacy-safe numeric prompt-size breakdown in local logs
   (`instruction_chars`, `history_chars`, `tool_list_chars`, `prompt_chars`)
   to reveal which segment contributes to remaining large prompts, never
   logging caller content or secrets.
5. Add offline regression coverage for long caller instructions, duplicate
   instructions, full tool inventory, small tool-name listing and log privacy.
6. Have user retest authenticated Windows Claude Code with the unchanged
   9Router binary; if Composer still mutates long text, address editor fidelity
   separately. Do not treat the prompt reduction as proof of a Send fix.

## Acceptance criteria

- All unique caller instructions and conversation history survive exactly.
- Browser prompt excludes duplicated system instructions and tool manual text.
- Complete tools and schemas remain available through MCP inventory and
  invocation argument validation remains unchanged.
- Local logs report aggregate sizes only, without tokens, prompts or keys.
- TypeScript checks and offline tests pass; authenticated ChatGPT UI result
  must be checked before claiming successful live end-to-end execution.

## Evidence and remaining risk

- User's Windows daemon logs: three failed 17-tool browser turns, each with
  `commonPrefixChars=22434`, not an HTTP parse or authentication failure.
- Fork: `session-manager.ts` prompt assembly and `tool-policy.ts` full manuals.
- Safe prompt reduction cannot itself guarantee that an approximately 110k
  character caller-supplied instruction/history survives ChatGPT's Lexical
  editor. No truncation is permitted, and Send remains fail-closed on mismatch.
