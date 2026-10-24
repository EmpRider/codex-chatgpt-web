# R9-045 — Accept Claude Code Draft 2020-12 tool schemas safely

- **Epic:** [R9-E06 — 9Router protocol and coding-agent interoperability](../epics/R9-E06-agent-protocols.md)
- **Status and evidence:** See [manifest.json](../manifest.json)
- **Dependencies:** R9-027 (Claude tool protocol), R9-033 (tool-validation trust boundary)

## Detailed description

During a real Windows test using Claude Code through unmodified 9Router, text-only
session naming completed, but every ordinary agent request failed immediately with
HTTP 422: `Function at index 0 has an invalid or unsupported JSON Schema`.
The user obtained a local, sanitized validation diagnostic identifying the first
tool as `Agent` and the exact cause as an unregistered meta-schema URI:
`https://json-schema.org/draft/2020-12/schema`.

The original 9Router adapter compiled every incoming function's `parameters`
with the default Ajv instance (Draft 7). Claude Code's advertised `Agent`
function uses Draft 2020-12, and unmodified 9Router preserves its `input_schema`
while translating Claude tools into Responses functions. This is a legitimate
agent-supplied schema dialect, not a reason to drop tools or disable validation.

## Implementation steps

1. Preserve the existing Draft 7 validator for tools without a declared newer
   dialect and do not modify the upstream native Codex parser.
2. Add a separate Ajv Draft 2020-12 validator, selecting it only when an external
   9Router function declares the matching `$schema` URI.
3. Use the selected validator both when accepting tool declarations and when
   checking arguments returned through the MCP tool-call bridge.
4. Add offline regression tests with Claude Code-style Draft 2020-12 metadata,
   draft-specific validation features, invalid tool arguments, unknown dialects,
   and a mixed Draft 7 + Draft 2020-12 tool inventory.
5. Run TypeScript checking and the 9Router protocol test suite. Re-test the real
   Windows Claude Code request after updating the fork and restarting `bun run app`.

## Acceptance criteria

- A valid Draft 2020-12 `Agent` tool no longer produces the meta-schema 422.
- Both Draft 7 and Draft 2020-12 tool arguments are validated according to their
  advertised schemas, including required fields and disallowed extras.
- Malformed schemas and unknown schema dialects still fail closed with 422.
- No 9Router installation, coding agent, or upstream/native Codex files change.
- An authenticated Claude Code live tool round trip remains part of R9-043;
  offline acceptance must not be described as an E2E success.

## Reference-first and verification evidence

- Real Windows failure: `Agent` tool, index 0, unregistered 2020-12 meta-schema.
- Unmodified 9Router: `open-sse/translator/request/claude-to-openai.js`
  forwards Claude `input_schema`; `request/openai-responses.js` maps the
  resulting function parameters to the Responses API.
- Fork: `src/integrations/nine-router/tool-policy.ts` and
  `tests/nine-router-provider.test.ts`.
- Locally observed: TypeScript typecheck passes and a Node/Ajv dialect smoke
  validates success and argument rejection. Bun's full tests and real Windows
  Claude Code retry remain separate acceptance evidence.
