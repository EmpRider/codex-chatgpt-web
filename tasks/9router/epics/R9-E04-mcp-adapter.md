# R9-E04 — Reuse the OpenAI Tunnel, browser and MCP capability broker

## Goal

Bind ChatGPT Web to the current external agent's tool inventory using a new adapter contract, while preserving existing Codex Full/Zero Risk modes.

## Epic definition of done

The authenticated browser MCP connector sees a turn-bound generic inventory and can request tools without local execution authority.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-015](../items/R9-015-define-pluggable-agent-turn-owner-for-the-browser-adapter.md) | Define pluggable agent turn owner for the browser adapter | R9-013, R9-014 |
| [R9-016](../items/R9-016-extend-turnbroker-with-external-agent-scoped-capabilities.md) | Extend TurnBroker with external-agent scoped capabilities | R9-015 |
| [R9-017](../items/R9-017-expose-agent-neutral-inventory-and-calls-through-existing-mcp-tunnel.md) | Expose agent-neutral inventory and calls through existing MCP tunnel | R9-011, R9-016 |
| [R9-018](../items/R9-018-compile-truthful-generic-agent-prompts-plugins-and-skills-context.md) | Compile truthful generic-agent prompts, plugins and skills context | R9-010, R9-015, R9-017 |
| [R9-019](../items/R9-019-preserve-browser-and-tunnel-lifecycle-through-external-tool-rounds.md) | Preserve browser and tunnel lifecycle through external tool rounds | R9-016, R9-017, R9-018 |

## References to inspect before development

- [chatgpt-web/mcp-server.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/mcp-server.ts)
- [chatgpt-web/turn-broker.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts)
- [chatgpt-web/prompt.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/prompt.ts)
- [src/tunnel.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/tunnel.ts)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
