# MCP Context Transport Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep large Full-harness Codex context out of ChatGPT's visible Lexical composer and deliver it losslessly through the existing turn-bound MCP bridge.

**Architecture:** Large automatic Full-mode prompts compile into a compact browser bootstrap plus a broker-owned immutable canonical context payload. The existing `codex_tool_inventory`/`codex_tool_call` ABI exposes and reads a bridge-reserved `codex_web_context_read` wire name, so no new public MCP tool is registered. Small Full-mode prompts and all non-Full paths retain existing inline/multipart behavior.

**Tech Stack:** TypeScript, Bun 1.4.0, `@modelcontextprotocol/sdk`, existing Unix-socket/Windows-pipe TurnBroker, Bun test.

**Spec:** `docs/superpowers/specs/2026-09-13-mcp-context-transport-design.md`

## Global Constraints

- Do not add a new public MCP tool or change the `Codex Native2` connector identity.
- Preserve exact canonical context bytes/string content; no lossy compression or summarization is part of this feature.
- Automatic Full mode only; Zero Risk/manual, browser-only, and compaction paths keep existing transport semantics.
- Context installation must complete before browser submission.
- Context payload must become immutable after the first MCP binding is created.
- Context must retire with the turn.
- Use a 32,768-character eligibility threshold and 32,768-character maximum chunk size.
- Preserve current image attachment behavior.
- Broker/DEV owner protocol compatibility must be explicit; bump the owner protocol version for the new owner operation.

---

### Task 1: Context transport primitives and prompt compilation

**Files:**
- Create: `src/adapters/chatgpt-web/context-transport.ts`
- Modify: `src/adapters/chatgpt-web/prompt.ts`
- Test: `tests/prompt-contract.test.ts`

**Interfaces:**
- Produces `CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS = 32_768`.
- Produces `CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS = 32_768`.
- Produces `ChatGptWebMcpContextTransport` with `{ contextId, sha256, chars, bytes, chunkChars, text }`.
- Produces `createChatGptWebMcpContextTransport(text: string): ChatGptWebMcpContextTransport`.
- Extends `CompiledChatGptWebPrompt` with optional `contextTransport`.

- [ ] **Step 1: Write failing prompt tests**

Add tests proving that a Full-mode context larger than 32,768 characters does not appear in `compiled.text`, returns `compiled.contextTransport.text` equal to the exact canonical JSON envelope, and produces a bootstrap containing `codex_web_context_read`, context ID/hash/chunk metadata, and the active `turn_token`. Add a second test proving a small Full-mode request remains inline and has no `contextTransport`.

- [ ] **Step 2: Run the prompt tests and confirm RED**

Run: `bun test tests/prompt-contract.test.ts`

Expected: failure because `CompiledChatGptWebPrompt.contextTransport` and the reserved context-reader bootstrap do not exist.

- [ ] **Step 3: Implement the context transport primitive**

Create `context-transport.ts` with deterministic SHA-256 identity and chunk metadata. `contextId` must be `ctx_` followed by 32 lowercase hex characters derived from the full SHA-256. Calculate `bytes` with `Buffer.byteLength(text, "utf8")`.

- [ ] **Step 4: Implement prompt selection**

In `compileChatGptWebPrompt()`, build the canonical non-multipart envelope JSON before choosing transport. For automatic local-tool mode, non-compaction, non-manual turns whose canonical envelope is at least `CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS`, return the exact envelope as `contextTransport` and emit a compact bootstrap instead of `<codex_context_json>...`.

The bootstrap must instruct the model to first discover `codex_web_context_read` with `codex_tool_inventory`, then read every chunk through `codex_tool_call` before executing any task or calling any other work tool. Keep normal output-format, checkpoint, image-reference, and capability contracts in the visible bootstrap.

- [ ] **Step 5: Run prompt tests and confirm GREEN**

Run: `bun test tests/prompt-contract.test.ts`

Expected: all prompt-contract tests pass.

---

### Task 2: Broker-owned immutable context storage and chunk reads

**Files:**
- Modify: `src/adapters/chatgpt-web/turn-broker.ts`
- Test: `tests/turn-broker-lifecycle.test.ts`
- Test: `tests/zero-risk-mcp-lifecycle.test.ts`

**Interfaces:**
- Extends `TurnBrokerOwner` with `setContextTransport(token: string, context: ChatGptWebMcpContextTransport): void | Promise<void>`.
- Adds owner wire method `owner_set_context` for `RemoteTurnBroker`.
- Adds broker-local binding wire method `context_read` taking `{ bindingId, contextId, chunk }`.
- Context read returns `{ context_id, sha256, chars, bytes, chunk, total_chunks, text, next_chunk }`.

- [ ] **Step 1: Write failing broker tests**

Add tests that register a turn, install context, claim/bind it, read every chunk through `callTurnBroker({ method: "context_read", ... })`, reconstruct exact text, reject a wrong context ID/out-of-range chunk, reject replacement after binding, and reject reads after turn retirement. Add a RemoteTurnBroker test proving owner-side context installation reaches the live broker.

- [ ] **Step 2: Run targeted broker tests and confirm RED**

Run: `bun test tests/turn-broker-lifecycle.test.ts tests/zero-risk-mcp-lifecycle.test.ts`

Expected: failure because context owner/read broker operations do not exist.

- [ ] **Step 3: Add channel context storage and validation**

Store `contextTransport` directly on `TurnChannel`, never inside `ChatGptTurnEnvironment`. Validate IDs, hashes, character/byte counts, chunk size, and exact content-derived identity before accepting owner installation. Permit replacement only while `bindingId` is absent.

- [ ] **Step 4: Add broker wire operations**

Add `owner_set_context` and `context_read` to `BrokerRequest`, validation, dispatch, and RemoteTurnBroker. Bump the DEV owner protocol version by one everywhere it is asserted. `context_read` must require a live binding and return slices computed from the stored immutable string.

- [ ] **Step 5: Run targeted broker tests and confirm GREEN**

Run: `bun test tests/turn-broker-lifecycle.test.ts tests/zero-risk-mcp-lifecycle.test.ts`

Expected: all targeted broker lifecycle tests pass.

---

### Task 3: Existing MCP ABI exposes the bridge reader

**Files:**
- Modify: `src/adapters/chatgpt-web/mcp-server.ts`
- Test: `tests/zero-risk-mcp-lifecycle.test.ts` or the existing Full MCP lifecycle test that exercises `codex_tool_inventory`/`codex_tool_call`

**Interfaces:**
- Defines reserved wire name `codex_web_context_read` inside the bridge implementation.
- `codex_tool_inventory` includes a synthetic read-only descriptor only when broker context exists for the claimed turn.
- `codex_tool_call` intercepts that wire name and returns broker `context_read` data without queuing an outer Codex tool invocation.

- [ ] **Step 1: Write failing MCP lifecycle tests**

Start the existing stdio MCP server against a broker turn with installed context. Verify `codex_tool_inventory` can discover exactly one `codex_web_context_read` entry and `codex_tool_call` returns chunk text while `broker.nextToolBatch()` remains empty/pending. Verify a turn without stored context does not advertise the synthetic descriptor.

- [ ] **Step 2: Run the MCP lifecycle test and confirm RED**

Run the single relevant Bun test file/test name.

Expected: failure because inventory does not expose the reserved bridge reader.

- [ ] **Step 3: Implement synthetic inventory and direct bridge dispatch**

Keep the registered MCP tool set unchanged. Add the synthetic descriptor to inventory pagination/search. In `codex_tool_call`, handle the reserved name inside `withClaimedTurn()` before normal `safeVisibleTools()`/gateway dispatch, validate structured arguments only, and call the broker `context_read` operation with the claimed binding.

- [ ] **Step 4: Run MCP lifecycle tests and confirm GREEN**

Run the relevant lifecycle test file.

Expected: context transport works without adding any new MCP tool name to the public server tool list.

---

### Task 4: Adapter wiring, docs, and full regression verification

**Files:**
- Modify: `src/adapters/chatgpt-web/index.ts`
- Modify: `docs/architecture.md`
- Test: `tests/chatgpt-web-harness.test.ts`
- Test: `tests/prompt-contract.test.ts`

**Interfaces:**
- `prepareWith()` installs `compiled.contextTransport` on the active turn token before publishing the token or returning the browser prompt.
- A later retained `prepareResume()` may replace the unbound transport before submission.

- [ ] **Step 1: Write failing adapter test**

Add a harness-level test with a large Full-mode request and a broker spy/fake proving context installation occurs before the browser worker receives/sends the compact bootstrap. Assert the bootstrap does not contain the large sentinel payload.

- [ ] **Step 2: Run the harness test and confirm RED**

Run the targeted `tests/chatgpt-web-harness.test.ts` test.

Expected: failure because the adapter does not install compiled context transport.

- [ ] **Step 3: Wire context installation into `prepareWith()`**

After compilation and before token publication/return, call `broker.setContextTransport(turnToken, compiled.contextTransport)` when present. Do not install anything for inline prompts. Preserve revoke-on-preparation-failure behavior.

- [ ] **Step 4: Update architecture documentation**

Document that automatic Full mode uses bridge-owned MCP context transport for large canonical envelopes, while browser-only/manual/compaction and small prompts retain the established paths. State explicitly that no new public MCP tool was added.

- [ ] **Step 5: Run targeted tests**

Run:

```bash
bun test tests/prompt-contract.test.ts
bun test tests/turn-broker-lifecycle.test.ts
bun test tests/zero-risk-mcp-lifecycle.test.ts
bun test tests/chatgpt-web-harness.test.ts
```

Expected: PASS.

- [ ] **Step 6: Run repository verification**

Run:

```bash
bun run typecheck
bun test ./tests
bun run verify
```

Expected: PASS with no new warnings/errors.

- [ ] **Step 7: Review the branch diff**

Confirm no giant context payload is logged, no public MCP tool was added, browser-only/manual semantics are unchanged, and no context can be read after turn retirement.
