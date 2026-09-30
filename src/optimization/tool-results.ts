import type { BrokerToolResult } from "../adapters/chatgpt-web/turn-broker";
import { compressCommandResultWithHeadroom } from "./headroom";
import { compressCommandResultWithRtk } from "./rtk";

export function hasCommandSessionMetadata(result: BrokerToolResult): boolean {
  if (result.structuredContent !== undefined) return true;
  if (!Array.isArray(result.content)) return false;
  return result.content.some(block => {
    if (!block || typeof block !== "object" || Array.isArray(block)) return false;
    const value = block as Record<string, unknown>;
    if (value.type !== "text" || typeof value.text !== "string") return false;
    return /\bsession[_ -]?id\b/i.test(value.text)
      || /\bprocess\s+(?:is\s+)?(?:still\s+)?running\b/i.test(value.text);
  });
}

export async function optimizeNativeCommandResult(
  result: BrokerToolResult,
  command?: string,
): Promise<BrokerToolResult> {
  if (hasCommandSessionMetadata(result)) return result;
  const rtk = await compressCommandResultWithRtk(result, undefined, command);
  return compressCommandResultWithHeadroom(rtk);
}
