export interface ChatGptConversationCleanupResult {
  found: number;
  pruned: number;
  retained: number;
}

export interface ChatGptConversationCleanupOptions {
  keepExchanges?: number;
  turnSelector?: string;
  userTurnSelector?: string;
  assistantTurnSelector?: string;
}

/**
 * Remove rendered history while keeping ChatGPT's stable logical turn containers intact.
 *
 * Playwright serializes this function into the page, so it must remain self-contained and may
 * reference only browser globals and its arguments.
 */
export function cleanChatGptConversationDocument(
  options: ChatGptConversationCleanupOptions = {},
  root: ParentNode = document,
): ChatGptConversationCleanupResult {
  const keepExchanges = Number.isInteger(options.keepExchanges) && options.keepExchanges! >= 0
    ? options.keepExchanges!
    : 3;
  const turnSelector = options.turnSelector ?? '[data-testid^="conversation-turn-"]';
  const userTurnSelector = options.userTurnSelector
    ?? '[data-testid^="conversation-turn-"][data-turn="user"]';
  const assistantTurnSelector = options.assistantTurnSelector
    ?? '[data-testid^="conversation-turn-"][data-turn="assistant"]';
  const turns = Array.from(root.querySelectorAll<HTMLElement>(
    turnSelector,
  ));
  const userTurns = Array.from(root.querySelectorAll<HTMLElement>(userTurnSelector));
  const assistantTurns = Array.from(root.querySelectorAll<HTMLElement>(assistantTurnSelector));
  const retainedTurns = new Set([
    ...userTurns.slice(-keepExchanges),
    ...assistantTurns.slice(-keepExchanges),
  ]);
  const turnsToPrune = turns.filter(turn => !retainedTurns.has(turn));

  for (const turn of turnsToPrune) {
    // New ChatGPT renderer: data-turn-key is the stable logical shell for the exchange.
    // Keep that shell while removing its heavy rendered children so the worker's baseline
    // cannot mistake an old remounted turn for a newly submitted user message.
    if (turn.hasAttribute?.("data-turn-key")) {
      turn.replaceChildren();
      turn.setAttribute("aria-hidden", "true");
      turn.setAttribute("data-chat-cleaned", "true");
      continue;
    }

    const identityContainer = turn.closest<HTMLElement>("[data-turn-id-container]");
    if (identityContainer !== turn) {
      turn.remove();
      continue;
    }

    // Some ChatGPT layouts place the rendered turn attributes directly on the stable identity
    // container. Keep that lightweight shell so the worker's virtualization-aware baseline can
    // still recognize the logical history, but strip everything that contributes layout or paint.
    turn.replaceChildren();
    turn.removeAttribute("data-testid");
    turn.removeAttribute("data-turn");
    turn.removeAttribute("data-message-author-role");
    turn.removeAttribute("data-turn-id");
    turn.setAttribute("aria-hidden", "true");
    turn.setAttribute("data-chat-cleaned", "true");
  }

  return {
    found: turns.length,
    pruned: turnsToPrune.length,
    retained: turns.length - turnsToPrune.length,
  };
}
