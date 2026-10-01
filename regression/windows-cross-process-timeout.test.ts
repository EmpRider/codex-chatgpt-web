import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";

const windowsOnly = process.platform === "win32" ? test : test.skip;

windowsOnly("Windows broker survives repeated MCP timeouts across a separate client process", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-win-xproc-"));
  const socketPath = defaultBrokerEndpoint(root, "win32");
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "windows-cross-process-timeout");

    const firstBatchPromise = broker.nextToolBatch(token);
    const child = Bun.spawn([
      process.execPath,
      join(import.meta.dir, "windows-broker-client.ts"),
      socketPath,
      token,
    ], {
      cwd: join(import.meta.dir, ".."),
      stdout: "pipe",
      stderr: "pipe",
    });
    const stdoutPromise = new Response(child.stdout).text();
    const stderrPromise = new Response(child.stderr).text();

    const [firstRequest] = await firstBatchPromise;
    expect(firstRequest?.arguments?.cmd).toBe("cross-process-timeout-1");

    // nextToolBatch intentionally replays a delivered call while it is still pending. Let the
    // separate MCP client cross its first timeout and settle that activity before asking for the
    // next native batch, otherwise this assertion would only observe the valid replay.
    await Bun.sleep(300);
    const [secondRequest] = await broker.nextToolBatch(token);
    expect(secondRequest?.arguments?.cmd).toBe("cross-process-timeout-2");

    const exitCode = await child.exited;
    const stdout = await stdoutPromise;
    const stderr = await stderrPromise;
    expect(exitCode).toBe(0);
    expect(stderr).toBe("");
    const parsed = JSON.parse(stdout.trim()) as { bindingId: string };
    expect(parsed.bindingId).toStartWith("binding_");

    broker.completeTool(token, firstRequest!.callId, {
      content: [{ type: "text", text: "late-one" }],
      structuredContent: { recovered: 1 },
    });
    broker.completeTool(token, secondRequest!.callId, {
      content: [{ type: "text", text: "late-two" }],
      structuredContent: { recovered: 2 },
    });

    const recoveryActivity = "activity_crossrecoverabcdef";
    const recoveryClaim = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId: recoveryActivity,
    });
    expect(recoveryClaim.bindingId).toBe(parsed.bindingId);
    await expect(callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: recoveryClaim.bindingId,
      activityId: recoveryActivity,
      wireName: "exec_command",
      arguments: { cmd: "cross-process-timeout-1" },
    }, 2_000)).resolves.toMatchObject({
      content: [{ type: "text", text: "late-one" }],
      structuredContent: { recovered: 1 },
    });
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: recoveryActivity,
    });

    const intentionalActivity = "activity_crossintentabcdef";
    const intentionalClaim = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId: intentionalActivity,
    });
    const nextBatchPromise = broker.nextToolBatch(token);
    const intentional = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: intentionalClaim.bindingId,
      activityId: intentionalActivity,
      wireName: "exec_command",
      arguments: { cmd: "cross-process-timeout-1" },
    }, 5_000);
    const [intentionalRequest] = await nextBatchPromise;
    expect(intentionalRequest?.arguments?.cmd).toBe("cross-process-timeout-1");
    broker.completeTool(token, intentionalRequest!.callId, {
      content: [{ type: "text", text: "fresh-native-execution" }],
    });
    await expect(intentional).resolves.toMatchObject({
      content: [{ type: "text", text: "fresh-native-execution" }],
    });
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: intentionalActivity,
    });

    expect(broker.beginCompletionFence(token)).toBeDefined();
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
}, 20_000);
