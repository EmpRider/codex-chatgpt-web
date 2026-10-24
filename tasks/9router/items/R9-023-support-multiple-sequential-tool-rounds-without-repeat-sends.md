# R9-023 — Support multiple sequential tool rounds without repeat sends

- **Epic:** [R9-E05 — Round-trip tool calls and browser continuation](../epics/R9-E05-tool-loop.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-019](../items/R9-019-preserve-browser-and-tunnel-lifecycle-through-external-tool-rounds.md), [R9-022](../items/R9-022-consume-returned-function-call-output-and-resume-pending-mcp-calls.md)

## Detailed description

Permit ChatGPT to inspect a tool result, request another tool and continue until final answer, all within the original accepted browser turn. Ensure the external client's follow-up Responses request never causes an accidental second physical ChatGPT send.

## Implementation steps

1. Preserve browser conversation state and current-tool visibility on each continuation.
2. Stop and return a new function-call batch whenever ChatGPT requests more local work.
3. Return the final Markdown answer only after the last required tool result has settled.

## Acceptance criteria

- A Read → Edit → Test mock flow causes one ChatGPT submission and three distinct tool rounds.
- Each round receives fresh tool results and correct reasoning/text boundaries.
- Missing continuation data fails rather than constructing a misleading final answer.

## Required validation and evidence

Inspect browser send counter and broker trace for a three-round synthetic workflow.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/index.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/bridge.ts
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
