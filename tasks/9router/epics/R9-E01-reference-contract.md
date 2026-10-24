# R9-E01 — Reference-first baseline and interface contract

## Goal

Establish an evidence-backed compatibility contract from the fork, upstream MCP/tunnel path, and unmodified 9Router before adding code.

## Epic definition of done

Published protocol samples, decisions, frozen baseline, and an acceptance matrix with explicit unsupported cases.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-001](../items/R9-001-record-pinned-source-baselines-and-upstream-divergence.md) | Record pinned source baselines and upstream divergence | None |
| [R9-002](../items/R9-002-capture-9router-wire-contracts-and-protocol-fixtures.md) | Capture 9Router wire contracts and protocol fixtures | R9-001 |
| [R9-003](../items/R9-003-approve-agent-neutral-execution-and-trust-boundary-design.md) | Approve agent-neutral execution and trust-boundary design | R9-001, R9-002 |
| [R9-004](../items/R9-004-define-mvp-acceptance-gates-and-unsupported-behaviors.md) | Define MVP acceptance gates and unsupported behaviors | R9-002, R9-003 |

## References to inspect before development

- [docs/architecture.md ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/architecture.md)
- [docs/security-model.md ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md)
- [translator/ ](https://github.com/decolua/9router/blob/master/open-sse/translator/)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
