# R9-E06 — 9Router protocol and coding-agent interoperability

## Goal

Preserve standard tool/instruction semantics across the unmodified 9Router Claude, OpenAI and Responses paths.

## Epic definition of done

Claude Code, Codex and OpenCode fixture paths pass with documented proprietary-feature limitations.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-027](../items/R9-027-verify-claude-code-tool-use-and-tool-result-conversion.md) | Verify Claude Code tool_use and tool_result conversion | R9-021, R9-022 |
| [R9-028](../items/R9-028-preserve-direct-codex-and-codex-via-9router-behavior.md) | Preserve direct Codex and Codex-via-9Router behavior | R9-005, R9-012, R9-021 |
| [R9-029](../items/R9-029-verify-opencode-and-standard-openai-agent-clients.md) | Verify OpenCode and standard OpenAI agent clients | R9-021, R9-022 |
| [R9-030](../items/R9-030-preserve-skills-plugins-deferred-tools-and-prompt-context.md) | Preserve skills, plugins, deferred tools and prompt context | R9-011, R9-018, R9-027 |
| [R9-031](../items/R9-031-validate-model-alias-routing-discovery-and-streaming-fidelity.md) | Validate model alias routing, discovery and streaming fidelity | R9-009, R9-027, R9-029 |

## References to inspect before development

- [request/claude-to-openai.js ](https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js)
- [request/openai-responses.js ](https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js)
- [response/openai-responses.js ](https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
