# R9-E08 — Offline verification, documentation and release readiness

## Goal

Prove complete mock tool loops and upstream regression stability, document manual setup, then validate with a real ChatGPT session when authorized.

## Epic definition of done

Offline CI-ready checks pass; live manual acceptance evidence exists; release and rollback instructions are reviewable.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-037](../items/R9-037-add-provider-endpoint-and-normalization-unit-tests.md) | Add provider endpoint and normalization unit tests | R9-008, R9-011, R9-012 |
| [R9-038](../items/R9-038-build-a-synthetic-browser-mcp-turnbroker-integration-harness.md) | Build a synthetic browser/MCP/TurnBroker integration harness | R9-017, R9-023, R9-024, R9-025 |
| [R9-039](../items/R9-039-test-against-an-unchanged-local-9router-installation.md) | Test against an unchanged local 9Router installation | R9-027, R9-029, R9-031, R9-038 |
| [R9-040](../items/R9-040-run-direct-native-codex-and-multi-client-regression-suites.md) | Run direct native Codex and multi-client regression suites | R9-028, R9-039, R9-036 |
| [R9-041](../items/R9-041-execute-adversarial-protocol-and-security-test-matrix.md) | Execute adversarial protocol and security test matrix | R9-032, R9-033, R9-034, R9-035 |
| [R9-042](../items/R9-042-document-9router-installation-and-agent-setup-on-windows.md) | Document 9Router installation and agent setup on Windows | R9-009, R9-030, R9-039 |
| [R9-043](../items/R9-043-complete-live-mcp-tool-tests-upstream-sync-rehearsal-and-release-gate.md) | Complete live MCP tool tests, upstream-sync rehearsal and release gate | R9-038, R9-039, R9-040, R9-041, R9-042 |

## References to inspect before development

- [main/package.json ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/package.json)
- [main/CONTRIBUTING.md ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/CONTRIBUTING.md)
- [docs/release-validation.md ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/docs/release-validation.md)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
