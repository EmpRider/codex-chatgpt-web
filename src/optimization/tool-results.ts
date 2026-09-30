import type { BrokerToolResult } from "../adapters/chatgpt-web/turn-broker";
import { compressCommandResultWithHeadroom } from "./headroom";
import { compressCommandResultWithRtk } from "./rtk";

export async function optimizeNativeCommandResult(
  result: BrokerToolResult,
  command?: string,
): Promise<BrokerToolResult> {
  const rtk = await compressCommandResultWithRtk(result, undefined, command);
  return compressCommandResultWithHeadroom(rtk);
}
