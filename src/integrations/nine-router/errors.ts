export class NineRouterRequestError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}

/** Claude Code recognizes this error text and can compact its own canonical history. */
export class NineRouterContextLimitError extends NineRouterRequestError {
  readonly code = "context_length_exceeded";
  readonly type = "invalid_request_error";
  constructor(message: string, readonly contextWindow: number,
    readonly autoCompactTokenLimit: number, readonly estimatedInputTokens?: number) {
    // 9Router retains upstream status and message, but drops provider-specific error codes.
    // Claude Code's reactive compaction path requires a recognized too-long error.
    super(`Prompt is too long. ${message}`, 400);
  }
}
