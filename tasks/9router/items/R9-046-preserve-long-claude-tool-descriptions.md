# R9-046 — Preserve long Claude Code tool descriptions through 9Router

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Status and evidence:** See [manifest.json](../manifest.json)
- **Dependencies:** R9-027 (Claude tool protocol), R9-033 (tool validation trust boundary)

## Detailed description

After the real Windows Claude Code request cleared its Draft 2020-12 schema
validation failure, the next request failed with HTTP 400:
`Invalid function description at index 1`. The fork rejected any function
description longer than 12,000 characters. Unmodified 9Router converts
Claude `description` with `String(tool.description || "")`, so an otherwise
valid native Claude Code tool with an extensive description exceeded the
fork-only size cap. The error happens before ChatGPT or MCP execution.

Function descriptions are not expendable metadata: they document semantics,
permissions, and tool-specific usage. Silently removing or truncating the
canonical definitions would alter the originating coding agent's contract.
However, concatenating every long description into the initial ChatGPT browser
prompt can also exhaust the existing 180,000-character composer budget.

## Implementation steps

1. Preserve a full tool description up to a generous explicit per-tool bound;
   reject unreasonable oversize values with HTTP 413 and do not coerce a
   malformed non-string description.
2. Introduce an aggregate description-size guard at the 9Router request boundary.
3. Keep the exact full description in the external agent's broker environment
   so `codex_tool_inventory` can return it alongside the real argument schema.
4. Use a short description preview in the initial ChatGPT prompt and explicitly
   instruct the model to retrieve complete tool descriptions and schemas before
   invoking the advertised tool through `codex_tool_call`.
5. Add offline tests for long descriptions, invalid description values,
   per-tool and aggregate bounds, prompt size, and exact full broker inventory.
6. Re-run a real Claude Code request through unchanged 9Router on Windows.

## Acceptance criteria

- Ordinary Claude Code requests no longer fail merely because its advertised
  `Bash` or other native tool manual exceeds 12,000 characters.
- Tool identity, description and JSON Schema reach the MCP broker unmodified.
- The prompt contains enough information to discover the full inventory and
  does not embed every multi-page native manual.
- Invalid or extremely large declarations still fail closed before browser use.
- Direct/native Codex behavior, the upstream app, and the 9Router binary remain untouched.
- The live MCP read/write/tool-return cycle remains a separate R9-043 gate.

## Reference-first and verification evidence

- Real Windows observation: index 1 description rejected after the Draft 2020-12
  compatibility fix, while title calls without tools worked.
- 9Router: `open-sse/translator/request/claude-to-openai.js` forwards function
  descriptions as strings without imposing the fork's original 12,000 limit.
- Fork: `src/integrations/nine-router/tool-policy.ts`, `request.ts`,
  `session-manager.ts` and `tests/nine-router-provider.test.ts`.
- Offline TypeScript checking and a Node runtime smoke passed. The Bun suite
  and authenticated Windows Claude Code tool loop remain to be verified.
