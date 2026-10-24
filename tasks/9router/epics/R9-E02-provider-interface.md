# R9-E02 — Additive 9Router Responses provider surface

## Goal

Expose an authenticated, versioned, OpenAI-compatible endpoint and model discovery without touching the native Codex route.

## Epic definition of done

A generic 9Router Responses node can discover routes and send a mocked request; native Codex routing is unchanged.

All child tasks must be marked **done** with verifiable evidence in [manifest.json](../manifest.json). A passing unit test alone does not satisfy an account-bound live test.

## Child tasks

| Task | Description | Dependencies |
| --- | --- | --- |
| [R9-005](../items/R9-005-introduce-a-namespaced-feature-gated-integration-route.md) | Introduce a namespaced, feature-gated integration route | R9-003 |
| [R9-006](../items/R9-006-create-an-independent-provider-integration-secret.md) | Create an independent provider integration secret | R9-005 |
| [R9-007](../items/R9-007-implement-openai-style-model-discovery.md) | Implement OpenAI-style model discovery | R9-005, R9-006 |
| [R9-008](../items/R9-008-accept-validate-and-stream-external-responses-requests.md) | Accept, validate and stream external Responses requests | R9-005, R9-006 |
| [R9-009](../items/R9-009-resolve-provider-aliases-and-endpoint-url-compatibility.md) | Resolve provider aliases and endpoint URL compatibility | R9-002, R9-007, R9-008 |

## References to inspect before development

- [src/server.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/server.ts)
- [src/chatgpt-web-models.ts ](https://github.com/EmpRider/codex-chatgpt-web/blob/main/src/chatgpt-web-models.ts)
- [provider-nodes/route.js ](https://github.com/decolua/9router/blob/master/src/app/api/provider-nodes/route.js)
- [executors/default.js ](https://github.com/decolua/9router/blob/master/open-sse/executors/default.js)

## Scope guard

Change only **EmpRider/codex-chatgpt-web**. Do not modify 9Router, upstream, or an installed coding agent. Keep new integration code isolated from upstream-owned modules wherever practical. The existing OpenAI Tunnel + ChatGPT MCP capability path remains intact.
