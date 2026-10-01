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
    await callTurnBroker(socketPath, {
      method: "invoke",
      bindingId,
      activityId,
      wireName: "exec_command",
      arguments: { cmd: `cross-process-timeout-${index}` },
    }, 100);
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
