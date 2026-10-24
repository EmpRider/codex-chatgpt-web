# R9-030 — Preserve skills, plugins, deferred tools and prompt context

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-011](../items/R9-011-normalize-advertised-tools-and-validate-input-schemas.md), [R9-018](../items/R9-018-compile-truthful-generic-agent-prompts-plugins-and-skills-context.md), [R9-027](../items/R9-027-verify-claude-code-tool-use-and-tool-result-conversion.md)

## Detailed description

Verify that coding-agent skills expressed as instructions survive request translation, and skills or plugins exposed as tool definitions remain callable through the generic inventory. Do not attempt to install plugins, read external agent skill directories or execute client-specific hooks within the fork.

## Implementation steps

1. Test prompt-injected skill instructions and ordinary function tools named Skill, ToolSearch or MCP-namespaced names.
2. Ensure tool inventory shows only the current agent's advertised callable capabilities.
3. Differentiate standard tool protocols from proprietary slash commands, hooks and subagent services.

## Acceptance criteria

- Skill instructions retain their proper role/order in translated prompts.
- A skill represented by a callable function can round-trip its arguments and result.
- The compatibility matrix does not claim full proprietary plugin/hook support without proof.

## Required validation and evidence

Use synthetic Claude Code skill and MCP fixtures, plus a negative case for an unadvertised plugin tool.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
