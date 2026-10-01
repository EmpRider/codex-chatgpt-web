/** Serialized into the page by Playwright; keep all dependencies inside the function. */
export function waitForChatGptResponseDomChange(
  root: Element,
  options: { knownKey?: string; timeoutMs: number; minWaitMs?: number; attributeFilter: string[] },
): Promise<"changed" | "timeout"> {
  return new Promise(resolve => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let changeTimer: ReturnType<typeof setTimeout> | undefined;
    const startedAt = Date.now();
    let settled = false;
    const finish = (result: "changed" | "timeout") => {
      if (settled) return;
      settled = true;
      observer.disconnect();
      if (timer) clearTimeout(timer);
      if (changeTimer) clearTimeout(changeTimer);
      resolve(result);
    };
    const changed = () => {
      if (settled || changeTimer) return;
      const remaining = Math.max(0, (options.minWaitMs ?? 0) - (Date.now() - startedAt));
      if (!remaining) finish("changed");
      else changeTimer = setTimeout(() => finish("changed"), remaining);
    };
    const observer = new MutationObserver(changed);
    observer.observe(root, {
      subtree: true, childList: true, characterData: true,
      attributes: true, attributeFilter: options.attributeFilter,
    });
    timer = setTimeout(() => finish("timeout"), options.timeoutMs);
    // Close the race between the previous snapshot and installing this observer.
    const registry = (globalThis as typeof globalThis & {
      __CODEX_WEB_GPT_RESPONSE_OBSERVERS__?: {
        documentId: string; states: WeakMap<Element, { id: number; revision: number }>;
      };
    }).__CODEX_WEB_GPT_RESPONSE_OBSERVERS__;
    const state = registry?.states.get(root);
    if (state && `${registry!.documentId}:${state.id}:${state.revision}` !== options.knownKey) changed();
  });
}
