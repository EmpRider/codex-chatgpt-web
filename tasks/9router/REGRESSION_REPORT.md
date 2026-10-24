# Native regression and 9Router release evidence — 2026-10-24

## Tested artifacts

- Fork: `EmpRider/codex-chatgpt-web` additive `src/integrations/nine-router/` provider, behind a separate API key and existing Full/Automatic mode. Native `/v1/responses`, Codex config, model catalogue, launcher, browser worker and OpenAI tunnel implementation remain separately accessible.
- Upstream planning baseline: `9dd77354e446491d0328602363e70d349859ae02` (same native source tree as upstream `0901b9fb1976b4a984c7e9b4082c2868767bbf7c` before the additive feature).
- Unmodified 9Router runtime: `decolua/9router` `f39d8f07481ae8518e93175f0ecaaafa61573c6c`, package `0.5.109`, launched in Next development mode with a **temporary isolated** `DATA_DIR`; no tracked 9Router source files changed.

## Results (offline, no ChatGPT account)

| Command / scenario | Result | Meaning |
| --- | --- | --- |
| `bun x --no-install --bun tsc --noEmit` | **PASS** | TypeScript types for changed runtime and tests agree |
| `bun run scripts/build-runtime-bundle.ts` | **PASS** | Production runtime bundle generated successfully |
| `bun test tests/model-catalog.test.ts tests/server-compaction.test.ts tests/bridge-collaboration.test.ts tests/responses-text-controls.test.ts tests/compaction-browser-recovery.test.ts tests/compaction-v1.test.ts tests/retained-compaction.test.ts tests/responses-agent-message.test.ts tests/native-passthrough.test.ts tests/tunnel.test.ts tests/tunnel-service.test.ts tests/turn-broker-diagnostics.test.ts` | **159 PASS, 0 FAIL** | Existing native Codex routes, compaction, native collaboration, model catalogue and tunnel smoke |
| `bun test tests/nine-router-provider.test.ts tests/nine-router-mcp.test.ts tests/nine-router-harness.test.ts tests/nine-router-upstream-guard.test.ts tests/turn-broker-lifecycle.test.ts tests/responses-lite-tools.test.ts` | **53 PASS, 0 FAIL** | New provider and existing broker trust/lifecycle with real local stdio MCP |
| `CODEX_9ROUTER_SOURCE=<pinned-checkout> bun test tests/nine-router-source-contract.test.ts` | **1 PASS, 8 assertions** | The actual unchanged 9Router translator handles parallel tool calls and Claude→Responses history |
| `CODEX_9ROUTER_E2E_URL=http://127.0.0.1:20127 CODEX_9ROUTER_E2E_DATA_DIR=<isolated-data-dir> bun test tests/nine-router-local-9router.test.ts` | **1 PASS, 28 assertions** | Actual unchanged 9Router accepts custom provider credentials, `/v1/models`, OpenAI Responses and Claude Messages tool use/results; mock fork browser |
| `node tasks/9router/check-upstream-safe.mjs` | **PASS** | No inherited source modules changed outside the four declared integration seams |

### Full repository suite — honest result

`bun test` across the original and new source tests: **1495 pass, 92 skip, 3 fail (1590 tests, 109 files)** on this execution host. This is **not** a fully green run. The failures were:

1. `tests/native-network.test.ts`: original proxy/network assumption — a bare `.invalid` target is unexpectedly reachable through this host's transparent HTTP proxy. This failure was observed before the provider implementation and reproduces in isolation. It is not an integration request failure.
2. `launcher/tests/localization.test.cjs`: "native dialogs and IPC accept exactly the renderer's supported languages" failed in the large concurrent full-suite run; **passes when that file is rerun alone**.
3. Same launcher localization file: "all locales translate known doctor success checks without changing literal diagnostic data" failed in the large concurrent full-suite run; **passes when that file is rerun alone**. Isolation result: **10 pass, 0 fail**.

The last two indicate test-order/concurrency interaction in that full-suite invocation; root cause is unproven. They are **not claimed fixed**, but the 9Router feature does not touch launcher localization. Do not silently downgrade the full-suite failures to passes in release reports. Native-focused and additive-focused suites above were green.

## Non-overlap/rollback audit

- `src/server.ts` receives only the gated namespaced dispatch and lifecycle close.
- `src/cli.ts` receives the independent owner-local `9router-key` command.
- `src/adapters/chatgpt-web/turn-broker.ts` and `mcp-server.ts` receive the discriminated external-agent environment and capability checks; native Codex methods continue to require their existing owner metadata.
- Everything else new is under `src/integrations/nine-router/` and `tasks/9router/` plus `tests/nine-router-*.test.ts` / fixtures. No launcher module, normal Codex provider, browser worker or OpenAI tunnel runtime is replaced.
- Feature-off rehearsal: no saved key => 9Router route responds 404; `browser-only`/non-Automatic mode => disabled; native provider tests run normally. `9router-key disable` renames only the dedicated integration-key file, then restarting disables the route. Existing login/tunnel/Codex state remains.
- Ahead of future upstream merges, re-run `check-upstream-safe.mjs`, compare upstream changes to the four inherited seams and run the **native-focused regression** and new provider harness. It is a source-overlap sentinel, **not** a guarantee of conflict-free merges.
- **Upstream sync check on 2026-10-24:** queried the GitHub upstream comparison `miuuyy/codex-chatgpt-web` baseline `0901b9fb1976b4a984c7e9b4082c2868767bbf7c` versus `main`: **identical, 0 commits ahead/behind**. Therefore no upstream source changes exist to merge/rebase at this checkpoint. Re-run on the actual merge date; this is not a rehearsal of an unknown future conflict.

## Release decision

**Integration implementation and offline 9Router runtime interoperation: verified. Live production-ready claim: NOT YET.**

Still required (R9-043): logged-in ChatGPT desktop launcher in Windows Full/Automatic mode, confirmed official OpenAI Tunnel MCP connector, installed real Claude Code/OpenCode/Codex client tests with read/edit/Skill/ToolSearch and real agent approvals, a redacted transcript, and upstream-sync rehearsal against *then-current* upstream. Do not accept simulated tool results as evidence of a successful user-machine mutation.
