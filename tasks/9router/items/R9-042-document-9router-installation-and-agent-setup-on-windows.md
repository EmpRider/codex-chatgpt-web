# R9-042 — Document 9Router installation and agent setup on Windows

- **Epic:** [R9-E08 — Offline verification, documentation and release readiness](../epics/R9-E08-verification-release.md)
- **Milestone:** MVP
- **Status and evidence:** See [manifest.json](../manifest.json), the single authoritative task state
- **Dependencies:** [R9-009](../items/R9-009-resolve-provider-aliases-and-endpoint-url-compatibility.md), [R9-030](../items/R9-030-preserve-skills-plugins-deferred-tools-and-prompt-context.md), [R9-039](../items/R9-039-test-against-an-unchanged-local-9router-installation.md)

## Detailed description

Produce a step-by-step Windows-first setup guide for launching the fork, enabling its 9Router integration key, adding a generic OpenAI-compatible Responses provider node in 9Router, choosing the ChatGPT Web model and connecting Claude Code, Codex or OpenCode through the 9Router gateway.

## Implementation steps

1. Provide exact localhost base URL, node apiType, prefix, key placement and model naming examples.
2. Explain existing ChatGPT login, connector and tunnel requirements without asking 9Router to install MCP tools.
3. Include smoke-test commands, troubleshooting, permission boundaries and clean disable/uninstall steps.

## Acceptance criteria

- A fresh user can configure 9Router without editing 9Router source.
- Guide distinguishes fork API key from OpenAI tunnel API key and ChatGPT login.
- Setup does not overwrite Codex's existing provider route or workspace configuration.

## Required validation and evidence

Perform a documentation walkthrough with a clean Windows profile or equivalent mock install.

Before marking this task **done**, record a commit/PR, offline test log, fixture or document link as evidence using the task CLI. If a real ChatGPT account, OpenAI tunnel credential or local agent installation is required, leave the account-bound verification incomplete until a user actually performs it. Never record fake E2E results or secrets.

## Reference-first implementation rule

Read this task and the relevant reference source files **before editing code**. Follow the upstream/9Router pattern where it already solves the same problem; adapt only the portion needed for our fork's different goal. Add targeted regression tests for every behavioral change. If the reference approach is not suitable, document the exact reason in the implementation evidence.

- https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md
- https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md

## Out of scope

No changes to decolua/9router or miuuyy/codex-chatgpt-web; no new local tool-execution sandbox inside the fork; no replacement of the existing native Codex + OpenAI Tunnel path.
