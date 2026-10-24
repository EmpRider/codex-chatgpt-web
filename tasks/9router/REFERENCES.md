# Pinned sources and integration touchpoints

Planning inspected on 2026-10-24. Before implementation, re-read current source and pin revisions in the task evidence, because upstream and 9Router can change.

| Repository | Branch | Observed SHA | Write permission in this project |
| --- | --- | --- | --- |
| [Fork](https://github.com/EmpRider/codex-chatgpt-web) | main | 0901b9fb1976b4a984c7e9b4082c2868767bbf7c | **Only allowed source repo** |
| [Upstream](https://github.com/miuuyy/codex-chatgpt-web) | main | 0901b9fb1976b4a984c7e9b4082c2868767bbf7c | Read/reference only |
| [9Router](https://github.com/decolua/9router) | master | f39d8f07481ae8518e93175f0ecaaafa61573c6c | Read/reference only |

## Browser, tunnel and tool execution in the fork

- [docs/architecture.md](https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/architecture.md): browser-only vs Full, task-bound tabs, MCP tunnel and browser lifecycle.
- [docs/security-model.md](https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md): native verified cwd/roots/sandbox, turn capability, approvals, local loopback boundaries.
- [src/server.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/server.ts): Responses routing, parsing and streaming dispatch. New integration should add a separate path.
- [src/tunnel.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/tunnel.ts): official tunnel-client runtime connection and stdio MCP command.
- [src/adapters/chatgpt-web/mcp-server.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/mcp-server.ts): codex_tool_inventory, codex_tool_call, codex_exec, codex_apply_patch; claims broker capability.
- [src/adapters/chatgpt-web/turn-broker.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts): tool queue, delivery, completion and invalidation.
- [src/adapters/chatgpt-web/index.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts): browser turn, tool result handling, SSE event emission.
- [src/adapters/chatgpt-web/prompt.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/prompt.ts): instructions and connector binding; native Codex assumptions.
- [src/adapters/chatgpt-web/environment.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/environment.ts): trust boundary, native workspace authority.
- [src/responses/parser.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/responses/parser.ts): parsing standard/special tool specs and function_call_output.
- [src/bridge.ts](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts): Responses SSE function_call, custom_tool_call and tool_search_call mapping.
- [CONTRIBUTING.md](https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md): upstream's generic providers out-of-scope policy, evidence and regression expectations.
- [package.json](https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json): Bun test/typecheck/verify commands.

## 9Router generic provider and protocol translation

- [Provider node route](https://github.com/decolua/9router/blob/master/src/app/api/provider-nodes/route.js): accepts OpenAI-compatible type with apiType chat or responses, plus name, prefix, baseUrl.
- [Default executor](https://github.com/decolua/9router/blob/master/open-sse/executors/default.js): constructs baseUrl/responses and sends provider credentials.
- [Claude → OpenAI](https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js): tool declarations, tool_use and tool_result translation.
- [OpenAI ↔ Responses](https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js): function_call and function_call_output shapes.
- [Responses → OpenAI](https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js): stream tool deltas/items.
- [Translator docs](https://github.com/decolua/9router/blob/master/tests/translator/AGENTS.md): intermediate conversion can lose specialized tool metadata.

## Official tunnel-client contract

- [Connector behavior](https://github.com/openai/tunnel-client/blob/master/docs/connectors.md): outbound tunnel, MCP request/response dispatch, stdio MCP binding, 120-second hosted request limit.
- The current fork's MCP invocation timeout is 90 seconds. Any changed version or timeout must be verified at implementation time.

## Reference-first policy

Do not copy upstream or 9Router patterns blindly. Record the exact source behavior, why it fits or differs from our fork-only requirement, what integration seam was used, and tests proving that the existing native path remains unaffected.
