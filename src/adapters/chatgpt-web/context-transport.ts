import { createHash } from "node:crypto";

export const CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD = 32_768;
/** Backward-compatible name retained for older internal tests and callers. */
export const CHATGPT_WEB_MCP_CONTEXT_MIN_CHARS = CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD;
export const CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS = 32_768;
export const CHATGPT_WEB_MCP_CONTEXT_BATCH_CHUNKS = 5;
export const CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME = "codex_web_context_read";

export function chatGptWebMcpContextReadQuery(contextId: string): string {
  return `${CHATGPT_WEB_MCP_CONTEXT_READ_WIRE_NAME}:${contextId}`;
}

export interface ChatGptWebMcpContextManifest {
  contextId: string;
  sha256: string;
  chars: number;
  bytes: number;
  chunkChars: number;
}

export interface ChatGptWebMcpContextTransport extends ChatGptWebMcpContextManifest {
  text: string;
}

export interface ChatGptWebMcpContextChunk {
  context_id: string;
  sha256: string;
  chars: number;
  bytes: number;
  chunk: number;
  chunk_count: number;
  total_chunks: number;
  text: string;
  next_chunk: number | null;
}

function contextSha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function contextId(sha256: string): string {
  return `ctx_${sha256.slice(0, 32)}`;
}

export function createChatGptWebMcpContextTransport(text: string): ChatGptWebMcpContextTransport {
  const sha256 = contextSha256(text);
  return {
    contextId: contextId(sha256),
    sha256,
    chars: text.length,
    bytes: Buffer.byteLength(text, "utf8"),
    chunkChars: CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS,
    text,
  };
}

export function assertChatGptWebMcpContextTransport(
  value: ChatGptWebMcpContextTransport,
): ChatGptWebMcpContextTransport {
  if (!value || typeof value !== "object") throw new Error("Codex MCP context transport is invalid");
  if (typeof value.text !== "string" || value.text.length === 0) {
    throw new Error("Codex MCP context transport text is invalid");
  }
  const expected = createChatGptWebMcpContextTransport(value.text);
  if (value.contextId !== expected.contextId) throw new Error("Codex MCP context id does not match its payload");
  if (value.sha256 !== expected.sha256) throw new Error("Codex MCP context hash does not match its payload");
  if (value.chars !== expected.chars) throw new Error("Codex MCP context character count does not match its payload");
  if (value.bytes !== expected.bytes) throw new Error("Codex MCP context byte count does not match its payload");
  if (value.chunkChars !== CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS) {
    throw new Error("Codex MCP context chunk size is unsupported");
  }
  return structuredClone(expected);
}

export function chatGptWebMcpContextManifest(
  context: ChatGptWebMcpContextTransport,
): ChatGptWebMcpContextManifest {
  return {
    contextId: context.contextId,
    sha256: context.sha256,
    chars: context.chars,
    bytes: context.bytes,
    chunkChars: context.chunkChars,
  };
}

export function chatGptWebMcpContextChunks(
  context: ChatGptWebMcpContextTransport,
): string[] {
  const offsets = contextChunkOffsets(context);
  return offsets.slice(0, -1).map((start, index) => context.text.slice(start, offsets[index + 1]));
}

const chunkOffsets = new WeakMap<ChatGptWebMcpContextTransport, {
  text: string; chunkChars: number; offsets: number[];
}>();

function contextChunkOffsets(context: ChatGptWebMcpContextTransport): number[] {
  const cached = chunkOffsets.get(context);
  if (cached?.text === context.text && cached.chunkChars === context.chunkChars) return cached.offsets;
  if (!Number.isSafeInteger(context.chunkChars) || context.chunkChars < 2) {
    throw new Error("Codex MCP context chunk size is invalid");
  }
  const offsets = [0];
  let offset = 0;
  while (offset < context.text.length) {
    let end = Math.min(context.text.length, offset + context.chunkChars);
    // Do not split a UTF-16 surrogate pair across two MCP results. Rejoining JS slices would be
    // lossless, but an individual connector result containing a lone surrogate can be normalized
    // before it reaches the model.
    if (
      end < context.text.length
      && end > offset
      && context.text.charCodeAt(end - 1) >= 0xD800
      && context.text.charCodeAt(end - 1) <= 0xDBFF
      && context.text.charCodeAt(end) >= 0xDC00
      && context.text.charCodeAt(end) <= 0xDFFF
    ) {
      end -= 1;
    }
    offsets.push(end);
    offset = end;
  }
  if (offsets.length === 1) offsets.push(0);
  chunkOffsets.set(context, { text: context.text, chunkChars: context.chunkChars, offsets });
  return offsets;
}

export function chatGptWebMcpContextChunkBatch(
  context: ChatGptWebMcpContextTransport,
  requestedContextId: string,
  chunk: number,
  limit = 1,
): ChatGptWebMcpContextChunk {
  if (requestedContextId !== context.contextId) {
    throw new Error("Codex MCP context id does not match this turn");
  }
  if (!Number.isSafeInteger(chunk) || chunk < 0) throw new Error("Codex MCP context chunk is invalid");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > CHATGPT_WEB_MCP_CONTEXT_BATCH_CHUNKS) {
    throw new Error(`Codex MCP context batch size must be between 1 and ${CHATGPT_WEB_MCP_CONTEXT_BATCH_CHUNKS}`);
  }
  const offsets = contextChunkOffsets(context);
  const totalChunks = offsets.length - 1;
  if (chunk >= totalChunks) throw new Error("Codex MCP context chunk is out of range");
  const next = Math.min(totalChunks, chunk + limit);
  return {
    context_id: context.contextId,
    sha256: context.sha256,
    chars: context.chars,
    bytes: context.bytes,
    chunk,
    chunk_count: next - chunk,
    total_chunks: totalChunks,
    text: context.text.slice(offsets[chunk], offsets[next]),
    next_chunk: next < totalChunks ? next : null,
  };
}

export function chatGptWebMcpContextChunk(
  context: ChatGptWebMcpContextTransport,
  requestedContextId: string,
  chunk: number,
): ChatGptWebMcpContextChunk {
  return chatGptWebMcpContextChunkBatch(context, requestedContextId, chunk, 1);
}
