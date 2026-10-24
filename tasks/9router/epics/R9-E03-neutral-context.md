# R9-E03 — Normalize external-agent requests and trust

## Goal

Convert 9Router-forwarded requests to a truthful, agent-neutral context with caller-owned tool permissions.

## Epic definition of done

Tool specifications, instructions and conversation IDs are normalized without synthesizing trusted Codex cwd or sandbox facts.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-010](../items/R9-010-normalize-system-developer-user-and-assistant-history.md) | Normalize system, developer, user and assistant history | R9-008, R9-002 |
| [R9-011](../items/R9-011-normalize-advertised-tools-and-validate-input-schemas.md) | Normalize advertised tools and validate input schemas | R9-008, R9-010 |
| [R9-012](../items/R9-012-map-tool-choice-and-special-tool-kinds-safely.md) | Map tool_choice and special tool kinds safely | R9-011 |
| [R9-013](../items/R9-013-separate-external-tool-capability-from-trusted-codex-sandbox-state.md) | Separate external tool capability from trusted Codex sandbox state | R9-003, R9-011 |
| [R9-014](../items/R9-014-define-deterministic-external-turn-and-browser-session-ownership.md) | Define deterministic external turn and browser-session ownership | R9-010, R9-013 |

## References to inspect before development

- [responses/parser.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/responses/parser.ts)
- [chatgpt-web/environment.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/environment.ts)
- [request/claude-to-openai.js ](https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
