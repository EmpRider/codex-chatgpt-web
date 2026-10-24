# R9-031 — Validate model alias routing, discovery and streaming fidelity

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-009](../items/R9-009-resolve-provider-aliases-and-endpoint-url-compatibility.md), [R9-027](../items/R9-027-verify-claude-code-tool-use-and-tool-result-conversion.md), [R9-029](../items/R9-029-verify-opencode-and-standard-openai-agent-clients.md)

## Detailed description

Test provider prefixes and model IDs that include nested slashes, model discovery, streaming SSE ordering and text/tool interleaving as exercised by 9Router. Explicitly document client routing requirements and models that cannot meet the standard protocol.

## Implementation steps

1. Test model alias strings such as `ccw/chatgpt-web/<slug>` against 9Router routing.
2. Validate model-list import and SSE boundary/framing behavior with tool and non-tool responses.
3. Check that 9Router falls back only when the user deliberately configures fallback, not because the fork silently changes models.

## Acceptance criteria

- Selected model names reach the intended ChatGPT Web account route unchanged.
- Streaming text/tool boundaries are parseable for the target client formats.
- Misconfigured aliases produce clear errors and do not contaminate another session.

## Required validation and evidence

Run URL/model/stream contract fixtures through 9Router's model and response translators.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/decolua/9router/blob/master/open-sse/translator/request/claude-to-openai.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/request/openai-responses.js
- https://github.com/decolua/9router/blob/master/open-sse/translator/response/openai-responses.js

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
