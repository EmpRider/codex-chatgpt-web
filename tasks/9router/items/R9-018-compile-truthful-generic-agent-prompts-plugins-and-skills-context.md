# R9-018 — Compile truthful generic-agent prompts, plugins and skills context

- **Epic:** [R9-E04 — Reuse the OpenAI Tunnel, browser and MCP capability broker](../epics/R9-E04-mcp-adapter.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-010](../items/R9-010-normalize-system-developer-user-and-assistant-history.md), [R9-015](../items/R9-015-define-pluggable-agent-turn-owner-for-the-browser-adapter.md), [R9-017](../items/R9-017-expose-agent-neutral-inventory-and-calls-through-existing-mcp-tunnel.md)

## Detailed description

Create the browser prompt variant for an external coding agent. Preserve supplied system/developer instructions, tool definitions and skill-related context, but do not claim the selected client is Codex or that its commands are locally available to ChatGPT outside the current broker binding.

## Implementation steps

1. Rework only the prompt transport metadata that says `Codex` or assumes native sandbox rules.
2. Explain to the browser model that tools execute on the initiating agent under that agent's approvals.
3. Handle tools named Skill/ToolSearch and plugin-injected instructions without inventing installed skills.

## Acceptance criteria

- Prompt fixtures keep all supported caller instructions and tool descriptions.
- The prompt contains no invented directories, approvals or available plugins.
- Native Codex prompt snapshots remain unchanged.

## Required validation and evidence

Compare output snapshots for native Codex, generic Claude Code and generic OpenCode contexts.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/mcp-server.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/prompt.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/tunnel.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
