# R9-049 — Reuse native ChatGPT prompt compiler for external coding agents

- **Epic:** [R9-E04 — Reuse the OpenAI Tunnel, browser and MCP capability broker](../epics/R9-E04-mcp-adapter.md)
- **Status and evidence:** See [manifest.json](../manifest.json)
- **Dependencies:** R9-010 (role normalization), R9-027 (external tool protocol),
  R9-033 (trust boundary and argument validation)

## Detailed description

The native Codex route uses `compileChatGptWebPrompt()` in
`src/adapters/chatgpt-web/prompt.ts`. It starts with `Act as the model
backend...`, includes a transport and role-priority contract, serializes task
context into JSON, and fences that JSON as plain text to prevent ChatGPT's
Composer rich-text parsing from mutating Markdown-like history.

The initial additive 9Router implementation introduced its own
`<external_agent_request>` prompt assembly in `session-manager.ts`, including
raw role-labeled history. Despite working authentication and tool schema
translation, real Windows Claude Code requests failed pre-send when a
112k-character prompt was mutated inside Lexical. Separate prompt generators
are unnecessary architectural divergence. External agent tool privileges are
already enforced by the broker environment, while protocol translation and
agent-side approvals belong to 9Router and the originating agent.

## Implementation steps

1. Read the native prompt compiler, wire contracts and MCP broker trust
   enforcement before changing the 9Router adapter. Retain native Codex
   behavior and existing textual contract byte-for-byte where possible.
2. Extend `compileChatGptWebPrompt()` with a typed external-agent context
   input. Do not forge a `CodexParsedRequest` or native owner to reuse it.
3. Factor a single JSON-transport renderer used by the native and external
   variants, including fenced context payload, role priority, and turn resume.
4. Move external-agent-specific policy into the shared compiler. Keep only
   request normalization, broker registration, and turn orchestration in the
   9Router session manager; remove its custom prompt-string generator.
5. Preserve complete caller instructions, ordered conversation roles,
   image attachments, tool names, tool choice, and per-turn identity. Retrieve
   full tool descriptions/schemas lazily through the existing MCP broker.
6. Keep the external agent's native tooling and permissions with the
   originating coding agent. Never impersonate a native Codex owner or expose
   Codex-only shortcuts. The connector is a transport bridge.
7. Add offline tests for JSON context round-trip with large Markdown-rich
   content, exact roles and instructions, broker tool catalogs, no invented
   workspace authority, and unchanged native prompt fixtures.
8. On user-owned Windows, retest the entire unmodified 9Router → ChatGPT Web
   → Codex Native2 connector → Claude Code tool loop. Do not claim the Lexical
   mismatch or MCP tools are fixed without actual observed success.

## Acceptance criteria

- One exported prompt compiler serves native Codex and external agents, with
  explicit origin-specific policy and one common JSON framing renderer.
- `session-manager.ts` does not directly generate transport prompts.
- Native Codex `compileChatGptWebPrompt()` output and behavior remain stable.
- External-agent history does not become active Markdown in the Composer; it
  is JSON conversation data with a distinct external-agent identity.
- No role, history record, permission, or tool definition is dropped or
  elevated; arbitrary text is never run as local code.
- Static/offline tests pass; authenticated Windows tests remain an explicit
  pending acceptance gate if not available in the current environment.

## Reference-first evidence

- Native: `src/adapters/chatgpt-web/prompt.ts`, especially its inline
  `codex_context_json` serialization and `compileChatGptWebPrompt()`.
- External: `src/integrations/nine-router/session-manager.ts` and 9Router
  Responses normalization in `request.ts`.
- Permission boundaries: `src/adapters/chatgpt-web/mcp-server.ts`
  `requireNativeToolOwner()`, plus the external broker environment.
- Windows logs: `prompt_chars=112946`, `history_chars=98057`,
  `commonPrefixChars=15320`, no evidence of Send acceptance.
