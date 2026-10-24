# R9-E07 — Security, lifecycle, diagnostics and upstream-safety

## Goal

Protect credentials, authorization boundaries and live sessions, and make failures diagnosable without touching unrelated upstream behavior.

## Epic definition of done

Timeout, cancellation, isolation, rejection, redaction and feature-off tests pass under simulated failures.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-032](../items/R9-032-harden-auth-origins-cors-and-credential-boundaries.md) | Harden auth, origins, CORS and credential boundaries | R9-006, R9-013 |
| [R9-033](../items/R9-033-bound-mcp-calls-http-streams-cancellations-and-timeouts.md) | Bound MCP calls, HTTP streams, cancellations and timeouts | R9-019, R9-022 |
| [R9-034](../items/R9-034-enforce-session-concurrency-and-account-browser-isolation.md) | Enforce session concurrency and account/browser isolation | R9-014, R9-019, R9-024 |
| [R9-035](../items/R9-035-add-privacy-safe-diagnostics-and-correlation-ids.md) | Add privacy-safe diagnostics and correlation IDs | R9-021, R9-022, R9-033 |
| [R9-036](../items/R9-036-implement-feature-rollback-and-upstream-regression-guard.md) | Implement feature rollback and upstream regression guard | R9-005, R9-019, R9-035 |

## References to inspect before development

- [docs/security-model.md ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/security-model.md)
- [chatgpt-web/turn-broker.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/adapters/chatgpt-web/turn-broker.ts)
- [docs/connectors.md ](https://github.com/openai/tunnel-client/blob/master/docs/connectors.md)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
