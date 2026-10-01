import { callTurnBroker } from "../src/adapters/chatgpt-web/turn-broker";

const [socketPath, token] = Bun.argv.slice(2);
if (!socketPath || !token) throw new Error("usage: windows-broker-client <socket> <token>");

let bindingId = "";
for (let index = 1; index <= 2; index += 1) {
  const activityId = `activity_crossprocess${index}abcdef`;
  const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, {
    method: "claim",
    token,
    activityId,
  });
  bindingId ||= claimed.bindingId;
  if (claimed.bindingId !== bindingId) throw new Error("binding changed across timeout recovery");
  try {
    // The first call expires quickly so the next activity can start. Give the second call enough
    // time for the owner process to observe its delivery before it also expires and becomes a
    // recoverable late-result tombstone.
    const invokeTimeoutMs = index === 1 ? 100 : 1_500;
    await callTurnBroker(socketPath, {
      method: "invoke",
      bindingId,
      activityId,
      wireName: "exec_command",
      invokeTimeoutMs,
      arguments: { cmd: `cross-process-timeout-${index}` },
    }, null);
    throw new Error("timed invocation unexpectedly completed");
  } catch (error) {
    if (!String(error).includes("timed out")) throw error;
  } finally {
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId,
      activityAbandoned: true,
    });
  }
}

process.stdout.write(JSON.stringify({ bindingId }) + "\n");
