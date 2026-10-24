# R9-E05 — Round-trip tool calls and browser continuation

## Goal

Return model tool requests to the agent through 9Router and deliver actual results back into the same ChatGPT Web response.

## Epic definition of done

Sequential, parallel, failed and long-running tool requests are matched and resolved across Responses requests without fabricated results.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-020](../items/R9-020-queue-chatgpt-mcp-invocations-as-agent-owned-requests.md) | Queue ChatGPT MCP invocations as agent-owned requests | R9-016, R9-017, R9-019 |
| [R9-021](../items/R9-021-serialize-standard-responses-tool-call-events-and-call-ids.md) | Serialize standard Responses tool-call events and call IDs | R9-012, R9-020 |
| [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md) | Consume returned function_call_output and resume pending MCP calls | R9-014, R9-020, R9-021 |
| [R9-023](../items/R9-023-support-multiple-sequential-tool-rounds-without-repeat-sends.md) | Support multiple sequential tool rounds without repeat sends | R9-019, R9-022 |
| [R9-024](../items/R9-024-handle-parallel-tool-batches-deterministically.md) | Handle parallel tool batches deterministically | R9-022, R9-023 |
| [R9-025](../items/R9-025-preserve-tool-errors-output-formats-and-image-evidence.md) | Preserve tool errors, output formats and image evidence | R9-022 |
| [R9-026](../items/R9-026-define-continuation-and-compaction-state-after-failures-or-restart.md) | Define continuation and compaction state after failures or restart | R9-014, R9-023 |

## References to inspect before development

- [chatgpt-web/index.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts)
- [src/bridge.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts)
- [chatgpt-web/turn-broker.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
