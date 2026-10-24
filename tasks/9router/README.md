# 9Router feature: file-based task management

**Project:** Add ChatGPT Web as a provider to an **unmodified 9Router** installation, with tools executed by the originating coding agent, while keeping direct Codex functionality unchanged.

**Live state (2026-10-24):** 8 epics, **43 tasks**. Run `node tasks/9router/taskctl.mjs summary` for verified totals; implementation and offline tests are underway. Live account-bound verification is pending.

- [Implementation plan](PLAN.md)
- [Reference/source map](REFERENCES.md)
- [Protocol contract and examples](PROTOCOL.md)
- [Implementation and offline-test evidence](IMPLEMENTATION.md)
- [Windows setup / rollback instructions](WINDOWS_SETUP.md)
- [Machine-readable task state](manifest.json)
- [Epic specifications](epics/)
- [Individual detailed task descriptions](items/)

## One source of truth

- **manifest.json** is the authoritative status, dependency, evidence and blocker record for all tasks.
- **items/R9-NNN-*.md** contains the detailed scope, implementation steps, acceptance criteria, validation evidence and reference-first instructions.
- **epics/R9-E##-*.md** defines the epic objective and exit conditions.
- **taskctl.mjs** is a dependency-free Node CLI (also runnable with Bun) for displaying and updating task state. The script never performs an integration test or edits application code.
- Do not duplicate hand-written completion totals across files: use the CLI summary.

## Commands (Windows PowerShell, CMD, macOS or Linux)

Run from the repository root:

    node tasks/9router/taskctl.mjs summary
    node tasks/9router/taskctl.mjs list
    node tasks/9router/taskctl.mjs list todo
    node tasks/9router/taskctl.mjs show R9-001
    node tasks/9router/taskctl.mjs validate

When beginning a task whose dependencies are all done:

    node tasks/9router/taskctl.mjs start R9-001

When genuine task work and acceptance checks are finished:

    node tasks/9router/taskctl.mjs done R9-001 --evidence https://github.com/EmpRider/codex-chatgpt-web/commit/EXAMPLE_SHA

To record a real blocker:

    node tasks/9router/taskctl.mjs block R9-001 --reason "Waiting for a real account-bound MCP acceptance test"
    node tasks/9router/taskctl.mjs unblock R9-001

The example evidence SHA above is a **placeholder**, not an actual commit. Record real commit links, fixture/test log paths, PR links or redacted/manual acceptance reports instead.

## Status contract

| Status | Meaning |
| --- | --- |
| todo | Planned but no implementation activity has started |
| in_progress | Work started; all prerequisite tasks must already be done |
| blocked | Cannot progress; blockedReason must explain the exact unmet condition |
| done | Acceptance criteria verified and evidence recorded; all dependencies are done |

Only the CLI should mutate manifest status fields. A task cannot be completed directly from todo, cannot begin before its prerequisites finish, and cannot be called done without nonempty evidence. The CLI validates dependency references, cycles, missing files and all status invariants.

**Do not mark live E2E as done using an offline mock.** Account login, ChatGPT MCP connection and real coding agent file execution require their own observations. If those are not available, leave that task incomplete and progress through other safe offline work.

## Reference-first workflow for every implementation task

1. Read the task description, owning epic and [PLAN.md](PLAN.md) before editing.
2. Inspect the exact upstream, 9Router and fork reference files listed in the task. Prefer the original project's proven implementation where relevant.
3. Identify any intentional divergence and why it is needed for a generic 9Router provider.
4. Make a small fork-only change. Preserve existing Codex, Electron browser, OpenAI Tunnel/MCP and native model behavior.
5. Add and run offline tests for the change, plus the appropriate native regression tests.
6. Record actual evidence and then update status with the task CLI.
7. Update [REFERENCES.md](REFERENCES.md) if the upstream or 9Router source revisions changed.

Do not change decolua/9router, the upstream miuuyy repository, or agent installations while implementing these tasks. The task tracker itself is a fork-only addition in a new subtree, reducing merge overlap.

## Current epic breakdown

| Epic | Tasks | Objective |
| --- | ---: | --- |
| [R9-E01](epics/R9-E01-reference-contract.md) | 4 | Reference-first baseline and interface contract |
| [R9-E02](epics/R9-E02-provider-interface.md) | 5 | Additive 9Router Responses provider surface |
| [R9-E03](epics/R9-E03-neutral-context.md) | 5 | Normalize external-agent requests and trust |
| [R9-E04](epics/R9-E04-mcp-adapter.md) | 5 | Reuse the OpenAI Tunnel, browser and MCP capability broker |
| [R9-E05](epics/R9-E05-tool-loop.md) | 7 | Round-trip tool calls and browser continuation |
| [R9-E06](epics/R9-E06-agent-protocols.md) | 5 | 9Router protocol and coding-agent interoperability |
| [R9-E07](epics/R9-E07-security-reliability.md) | 5 | Security, lifecycle, diagnostics and upstream-safety |
| [R9-E08](epics/R9-E08-verification-release.md) | 7 | Offline verification, documentation and release readiness |

## Verification boundary

- **Planning + implementation:** The provider, MCP bridge and offline tests are added incrementally; status and evidence must be read from `manifest.json` and `IMPLEMENTATION.md`.
- **Offline testing:** Safe fixtures, syntax/type checks and unmodified local 9Router translation tests can be automated.
- **Live testing:** Real ChatGPT login and tunnel runtime credentials are not required for offline tests; they are necessary for final live acceptance.

The initial manifest had all 43 tasks as todo. Current states are in `manifest.json`; manual acceptance and production release remain incomplete until demonstrated.
