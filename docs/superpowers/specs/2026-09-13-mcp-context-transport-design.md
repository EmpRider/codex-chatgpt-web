# MCP Context Transport Design

## Goal

Eliminate the dominant ChatGPT Web UI lag caused by inserting very large Codex context envelopes into ChatGPT's Lexical composer. In Full harness mode, large task context should remain local and be delivered to the active ChatGPT response through the existing `Codex Native2` MCP bridge, while the visible browser prompt stays small.

## Scope

This change applies only to automatic Full harness turns that already have a live turn-bound MCP capability. Browser-only and Zero Risk/manual modes keep their existing inline or multipart transport. Compaction requests keep their existing transport because compaction deliberately runs without ordinary local tools.

The existing public MCP tool schema must not change. The `Codex Native2` connector identity is a public ABI and repository architecture requires a new connector identity for schema changes. Therefore context transport uses the existing `codex_tool_inventory` and `codex_tool_call` tools with a bridge-reserved wire name instead of registering a new MCP tool.

## Architecture

### Context payload

`compileChatGptWebPrompt()` continues to build the exact canonical JSON envelope currently embedded between `<codex_context_json>` tags. For eligible large Full-mode turns, it returns that JSON separately as `contextTransport` metadata and emits a compact browser bootstrap instead of embedding the JSON in visible prompt text.

The context payload is immutable for a submitted turn and includes:

- `contextId`: content-addressed opaque ID derived from SHA-256
- `sha256`: full UTF-8 payload hash
- `chars`: JavaScript string length for diagnostics
- `bytes`: UTF-8 byte length
- `chunkChars`: fixed maximum characters per MCP result
- `text`: exact canonical JSON envelope held only by the local broker

The default transport threshold is 32,768 context characters. Smaller Full-mode requests stay inline to avoid unnecessary connector round trips. The default chunk size is 32,768 characters so a single connector result is bounded while still keeping the number of MCP calls low.

### Broker storage

The active `TurnBroker` owns the context payload beside the turn environment. The outer adapter installs or replaces the payload after prompt compilation but before the browser sends the bootstrap. Replacement is allowed only before the turn has been bound by MCP; this supports the existing retained-conversation prepare/resume selection without permitting context mutation after ChatGPT begins reading it.

The payload is removed automatically when the turn channel is revoked, expires, or completes. It never goes into logs, the browser DOM, the connector configuration, or command-line arguments.

Remote DEV ownership gains the same context-install method through the existing broker protocol so repository DEV mode exercises the production path.

### MCP access without ABI change

The reserved bridge wire name is `codex_web_context_read`.

`codex_tool_inventory` exposes one synthetic descriptor for this wire name only when the claimed turn has a context payload. It is read-only, idempotent, and accepts:

```json
{
  "context_id": "ctx_...",
  "chunk": 0
}
```

`codex_tool_call` recognizes that reserved wire name before normal outer-Codex tool dispatch. It reads the requested chunk directly from the broker using the claimed binding and returns:

```json
{
  "context_id": "ctx_...",
  "sha256": "...",
  "chunk": 0,
  "total_chunks": 4,
  "text": "...exact context chunk...",
  "next_chunk": 1
}
```

The last chunk returns `next_chunk: null`. A wrong context ID, out-of-range chunk, stale turn token, retired binding, or missing context fails explicitly.

Because the request still goes through `withClaimedTurn()`, context reads participate in the existing MCP activity lease and completion fence. The browser response cannot commit while a context read is still active.

### Browser bootstrap

For eligible turns, the visible prompt contains the normal transport and output contracts but replaces the giant context block with a small manifest and explicit loading sequence. It instructs the model to:

1. query `codex_tool_inventory` for `codex_web_context_read` before any task work;
2. call `codex_tool_call` with the current `turn_token`, the reserved wire name, `context_id`, and chunk `0`;
3. continue reading `next_chunk` until it is `null`;
4. reconstruct the single canonical JSON envelope in chunk order;
5. interpret roles with the same semantics as the current inline transport;
6. only then execute the latest active user request.

The bootstrap includes the expected context ID, SHA-256, character count, byte count, and chunk count for diagnostics. The model is not asked to calculate SHA-256; integrity is enforced locally by content identity and broker validation.

Image attachments remain attached to the small bootstrap message and retain the same `image_attachment` references inside the canonical context JSON.

## Retained conversations

The existing retained-conversation suffix logic remains authoritative. If a retained turn compiles only the new canonical suffix, only that suffix is stored in the new turn's broker context payload. Prior context remains part of the retained ChatGPT conversation, including prior MCP tool results.

`prepareResume` may replace a not-yet-bound context payload installed by `prepare`. Once a connector claim has created a binding, replacement is rejected.

## Failure behavior

The feature is fail-closed for correctness:

- If broker context installation fails, the browser turn is not sent.
- If the context reader is unavailable or any chunk read fails, ChatGPT must not execute the task from a partial context.
- No silent fallback occurs after the small bootstrap has been sent, because resending the full prompt would create an ambiguous duplicate task.
- Browser-only and manual modes are unaffected and keep their current proven paths.

## Compatibility

No new MCP tool is registered, so `Codex Native2` remains the same public connector schema. The broker owner protocol version is incremented because DEV `RemoteTurnBroker` gains context installation support.

Existing inline prompt behavior remains unchanged for small Full-mode turns and all modes outside the eligible path.

## Testing

Tests must cover:

- large Full-mode prompt compilation produces a small bootstrap and separate exact context payload;
- small Full-mode prompts remain inline;
- browser-only, manual, multipart-only, and compaction behavior is unchanged;
- broker context storage is immutable after binding and disappears on retirement;
- context reads are isolated by binding, validate context ID and chunk range, and reconstruct byte-for-byte identical text;
- `codex_tool_inventory` exposes the synthetic reader only when context exists;
- `codex_tool_call` returns context chunks without emitting an outer Codex tool call;
- `RemoteTurnBroker` supports installing context under the bumped owner protocol;
- existing MCP lifecycle and completion-fence tests still pass.

## Success criteria

For a large Full-mode request, the browser-visible submitted user turn contains only the bootstrap and normal contracts, not the canonical context JSON. A 100k-500k-character canonical context therefore no longer creates a comparably large Lexical message. The model can still receive the exact canonical context through `Codex Native2`, and existing Codex tool semantics, turn isolation, cancellation, retained conversation ownership, and completion fencing remain intact.
