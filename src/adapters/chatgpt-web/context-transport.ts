import { createHash } from "node:crypto";

export const CHATGPT_WEB_MCP_PROMPT_JSON_BYTE_THRESHOLD = 32_768;
export const CHATGPT_WEB_MCP_CONTEXT_CHUNK_CHARS = 32_768;
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
  const chunks: string[] = [];
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
    chunks.push(context.text.slice(offset, end));
    offset = end;
  }
  return chunks.length > 0 ? chunks : [""];
}

export function chatGptWebMcpContextChunk(
  context: ChatGptWebMcpContextTransport,
  requestedContextId: string,
  chunk: number,
): ChatGptWebMcpContextChunk {
  if (requestedContextId !== context.contextId) {
    throw new Error("Codex MCP context id does not match this turn");
  }
  if (!Number.isSafeInteger(chunk) || chunk < 0) throw new Error("Codex MCP context chunk is invalid");
  const chunks = chatGptWebMcpContextChunks(context);
  if (chunk >= chunks.length) throw new Error("Codex MCP context chunk is out of range");
  return {
    context_id: context.contextId,
    sha256: context.sha256,
    chars: context.chars,
    bytes: context.bytes,
    chunk,
    total_chunks: chunks.length,
    text: chunks[chunk]!,
    next_chunk: chunk + 1 < chunks.length ? chunk + 1 : null,
  };
}
