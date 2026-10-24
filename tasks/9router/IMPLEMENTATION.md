# 9Router additive implementation: live development ledger

Updated 2026-10-24. This file records **implemented and offline-tested code**, not a claim of live ChatGPT login or Claude Code integration. The file-based task status remains authoritative in `manifest.json`.

## Immutable references and fork divergence (R9-001)

| Source | Pinned commit | Inspected locations |
| --- | --- | --- |
| Fork, pre-9Router planning | [`0901b9fb1976b4a984c7e9b4082c2868767bbf7c`](https://github.com/EmpRider/codex-chatgpt-web/commit/0901b9fb1976b4a984c7e9b4082c2868767bbf7c) | `src/server.ts`, `src/tunnel.ts`, `src/adapters/chatgpt-web/*` |
| Upstream official | [`0901b9fb1976b4a984c7e9b4082c2868767bbf7c`](https://github.com/miuuyy/codex-chatgpt-web/commit/0901b9fb1976b4a984c7e9b4082c2868767bbf7c) | Same native implementations; unchanged by this fork-only extension |
| Fork planning | [`9dd77354e446491d0328602363e70d349859ae02`](https://github.com/EmpRider/codex-chatgpt-web/commit/9dd77354e446491d0328602363e70d349859ae02) | `tasks/9router/*`, no runtime behavior changed |
| 9Router unmodified | [`f39d8f07481ae8518e93175f0ecaaafa61573c6c`](https://github.com/decolua/9router/commit/f39d8f07481ae8518e93175f0ecaaafa61573c6c) | `open-sse/executors/default.js`, `open-sse/translator/request/claude-to-openai.js`, `open-sse/translator/request/openai-responses.js`, `open-sse/translator/response/openai-responses.js`, `open-sse/translator/index.js` |

The implementation starts from the same source SHA as upstream; before implementation the fork's only added delta was the `tasks/9router/*` planning and tracking area. Use `git diff 0901b9fb1976b4a984c7e9b4082c2868767bbf7c...HEAD -- src` after fetching a complete history to review any inherited-file overlap on future upstream merges. **Do not change the upstream repository or 9Router.** Check both reference branch heads and refresh this ledger before every upstream merge.

## Verified 9Router wire contract (R9-002, repository-source observation)

For a custom OpenAI-compatible `apiType: responses` node, 9Router's `default.js:140-150` appends `/responses` to the configured base URL and authenticates using its provider credential. `claude-to-openai.js:46-72` maps Claude function declarations, and `:188-225` maps `tool_use` and `tool_result` to ordinary OpenAI tool calls and tool messages. `request/openai-responses.js:318-462` converts those into `input[]`, `instructions`, `tools[]`, and `function_call_output` records with `stream: true`. It deliberately sets `store: false` and does not preserve private Codex thread metadata. The reverse stream translator (`response/openai-responses.js:569-669`) consumes `response.output_item.added`, argument deltas, item completion and `response.completed` to synthesize OpenAI tool calls and a finish reason. A generic tool may become available to ChatGPT only if forwarded as a standard function declaration.

The Claude tool-result conversion **discards `is_error`** (its `tool_result` path captures text but not that flag). Multimodal tool outputs may be flattened to text or separate image messages. Proprietary skill/hook semantics, native freeform custom tools and Codex `tool_search_call` are not guaranteed by this unmodified translator. The fork explicitly rejects unsupported image/file blocks rather than pretending they were read.

The unmodified `DefaultExecutor` was invoked with an `openai-compatible-responses-*` node and provider data pointing to `http://127.0.0.1:17841/integrations/9router/v1`. Its observed URL was exactly `http://127.0.0.1:17841/integrations/9router/v1/responses`, with `Content-Type: application/json`, `Authorization: Bearer <provider-key>`, and `Accept: text/event-stream`. This confirms path and auth construction, **not** actual 9Router connection/GUI/model import. For model names, the fork accepts `chatgpt-web/<exact-slug>` or precisely one 9Router prefix such as `ccw/chatgpt-web/<exact-slug>`; no arbitrary fallback or repeated prefix is allowed.

## Minimal inherited changes (R9-003)

| Owned location | Change | Reason inherited seam unavoidable |
| --- | --- | --- |
| `src/server.ts` | One namespaced router dispatch plus lifecycle closure | Only the existing Bun listener can route the 9Router HTTP endpoint, without another port/process |
| `src/adapters/chatgpt-web/turn-broker.ts` | Discriminated `ExternalAgentTurnEnvironment`, tool-catalog-only registration and validation | Existing MCP connector claims its environment through the broker; an external agent must never be impersonated as trusted native Codex cwd/sandbox |
| `src/adapters/chatgpt-web/mcp-server.ts` | Narrow union environment; exclude native nested discovery for external agents | Existing `codex_tool_inventory` and `codex_tool_call` can safely reuse the same tunnel/MCP transport if the external catalog is strictly bounded |
| `src/integrations/nine-router/*` | Entire independent provider facade | Route/auth/models, normalizer and session continuation are specific to 9Router, not upstream native behavior |

No original native Codex model route, environment verification, tunnel client, browser worker, launcher or outbound connector was deleted or replaced.

## Current offline evidence

- Typecheck: `/root/.npm/_npx/214ebe133ee6a004/node_modules/.bin/bun x --no-install --bun tsc --noEmit` passes.
- Native regression: `bun test tests/responses-lite-tools.test.ts` passes.
- External provider: `bun test tests/nine-router-provider.test.ts` validates request trust boundaries, independent Bearer-authenticated model discovery, and an agent-side tool call through a **real local TurnBroker** with a test-double browser (no ChatGPT account). Includes genuine tool result handback and refusal of unrelated call IDs / conversation history.
- `bun test tests/turn-broker-lifecycle.test.ts tests/responses-lite-tools.test.ts tests/nine-router-provider.test.ts` passed after implementation (native and new broker tests).
- Full offline run (80 files): **1049 passed, 89 skipped, 4 failed**. Three Zero Risk adapter tests require the launcher-only `electron` package, which was not installed in this headless test environment (`Cannot find package 'electron' from launcher/electron/browser-host.cjs`). One native-network test presumes an unproxied bare `fetch()` must reject, but the sandbox host's proxy instead made that fetch resolve. These failures reproduced when the two files ran in isolation, and none exercises 9Router logic. **Do not report the full suite as green.**

## Agent-neutral authority decision and acceptance gates (R9-003 / R9-004)

The model sees a **declared tool interface**, not access to the server's filesystem. ChatGPT may request a declared function through the custom OpenAI Tunnel connector. The MCP server checks the exact advertised name and input schema, and the broker queues an opaque call. The originating agent receives a Responses function call and chooses whether to execute or approve it. Only its returned `function_call_output` is delivered back through the broker. A generic agent is identified by `{kind: 'external-agent', tools}` and is forbidden to claim native Codex `cwd`, `roots`, `sandboxPolicy` or private thread metadata. Native owner validation is untouched.

| Client / capability | Evidence required | Current status |
| --- | --- | --- |
| Claude Code text + function tool | Unmodified Claude→Responses translator fixture, SSE tool-call conversion | **Offline translator executed; fixture tests present**; no installed agent tested |
| Codex via 9Router | Native Responses client routed by generic provider, no Codex Native env assumptions | **Code path present**; local agent E2E pending |
| OpenCode or other agent | Ordinary named function declarations/results in Responses | **Protocol path present**; actual client E2E pending |
| MCP tools installed in coding agent | Agent advertises as standard functions; actual connector round-trip | **Broker simulated**; live MCP + tunnel pending |
| Skills in prompt/instructions | Translated text preserved with priority labels | **Offline parser coverage**; downstream agent-specific hooks are not available to the model automatically |
| Skills/plugins advertised as functions | Exact allowlisted name, schema and tool_result | **Offline broker coverage**; client-specific plugins unverified |
| Sequential and parallel tools | Unique call IDs; matching authenticated session/history; no duplicate/fake results | **Offline tests pass**; live retry/timeout scenarios pending |
| Tool errors | Preserve `is_error` or an honest equivalent across translator | **Not verified**; unmodified 9Router drops Claude `is_error` flag, so true error metadata is currently lost |
| Images/files/audio and freeform/custom/tool_search | Dedicated translator fixtures and downstream semantics | **Unsupported by this initial slice**; explicit rejection/no portability promise |
| ChatGPT Web account/tunnel/browser round-trip | Human-owned logged-in browser, configured official OpenAI tunnel and real connector | **Not run**; cannot close without account-bound evidence |
| Native direct Codex, browser-only, Zero Risk | Existing regression suite with integration disabled | **Representative offline tests passed**; full release suite pending |

One way to refresh the cross-project fixture check without modifying 9Router is to clone it into a temporary read-only directory at pinned revision, import `translateRequest` and `translateResponse` from `open-sse/translator/index.js`, and compare fixture output. This was performed locally at `f39d8f07481ae8518e93175f0ecaaafa61573c6c`: a Claude `tool_use` and `tool_result` became matching Responses `function_call` and `function_call_output`, and Responses SSE call events became OpenAI `tool_calls` deltas with `finish_reason: tool_calls`.

## Current limitations and unverified gates

- **No live ChatGPT/MCP/tunnel/browser round-trip** has been run. The browser worker is reused by source, but the account-bound connector must be verified on Windows with a logged-in ChatGPT account and configured Full-mode tunnel. Do not mark that task done on fake-browser evidence.
- This initial adapter accepts standard text and function tools, not raw custom/freeform tools, multimodal attachments or first-class tool-search APIs. Agent-defined skills are passed as instructions only when 9Router transmits them; tool-form skills can be invoked if present as ordinary named functions.
- Session identity is authenticated by a dedicated provider key, high-entropy broker call IDs, model identity and exact original history prefix; no forwarded proprietary private headers are assumed.
- External tool invocations still inherit the existing MCP timeout (90 seconds) and the browser/tunnel reliability constraints. Tool approvals taking longer than that may expire; automatic retries of mutating tools are prohibited.
- Key setup supports an owner-only file and dedicated create/rotate/disable CLI, plus an environment override. It does not yet have a launcher UI. Rotation or disabling takes effect after a daemon restart (there is no silent old-key grace period).
- Full unmodified 9Router executable fixtures, actual Claude Code/Codex/OpenCode interoperability, socket/process failure injection, public release and upstream rebase need further testing.

## Local setup for early manual testing

1. Configure the fork's existing ChatGPT login, Automatic **Full** mode and official OpenAI tunnel/MCP app exactly as the upstream fork documents.
2. Run `codex-chatgpt-web 9router-key create` to generate a random independent key in the fork's existing user configuration directory (`integrations/nine-router-key.json`, owner-only). From a source checkout use `bun src/cli.ts 9router-key create`. You can also supply a valid 32+ character `CODEX_CHATGPT_WEB_9ROUTER_API_KEY` environment override. Do **not** reuse ChatGPT cookies, OpenAI tunnel keys, or launcher control tokens. To rotate later, run the same CLI with `rotate`; to disable the saved key, use `disable`; then restart the daemon. The CLI deliberately prints only the file path, not the secret itself.
3. Restart the daemon. In 9Router, create a Custom OpenAI-compatible Responses provider with base URL `http://127.0.0.1:<fork-daemon-port>/integrations/9router/v1`, the generated provider key and an actual model ID from `GET .../models` (not the example placeholder). 9Router appends `/responses`.
4. Select that 9Router model in the originating coding agent. Its own tools are executed and approved by that agent. Check local privacy-safe logs if the bridge cannot match a continuation.

> Do not enter real credentials in tests or commit them. Do not call this integration production-ready until a logged-in live tool round and the P7/P8 acceptance matrix pass.
