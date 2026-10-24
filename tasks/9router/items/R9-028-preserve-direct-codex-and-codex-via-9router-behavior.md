# R9-028 — Preserve direct Codex and Codex-via-9Router behavior

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-005](../items/R9-005-introduce-a-namespaced-feature-gated-integration-route.md), [R9-012](../items/R9-012-map-tool-choice-and-special-tool-kinds-safely.md), [R9-021](../items/R9-021-serialize-standard-responses-tool-call-events-and-call-ids.md)

## Detailed description

Keep the existing native Codex route intact while verifying an independent Responses-mode Codex client can reach ChatGPT Web through 9Router. Distinguish native namespace/freeform/tool_search behavior from generic standard-function compatibility instead of promising that 9Router preserves every Codex extension.

## Implementation steps

1. Run current native tool, collaboration, compaction and model-catalog regression suites.
2. Test a generic Codex Responses function call through a custom 9Router node.
3. Flag unsupported `custom_tool_call`, special `tool_search_call`, encrypted multi-agent metadata or native-only headers in the compatibility matrix.

## Acceptance criteria

- Direct Codex existing integration remains byte-compatible on supported routes.
- Codex via 9Router works for agreed standard function tools.
- Unsupported proprietary features are rejected or documented, never misrepresented as fully supported.

## Required validation and evidence

Compare native regression outputs with baseline and run a 9Router Responses contract fixture.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
