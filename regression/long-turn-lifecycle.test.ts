import { expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint } from "../src/config";

function harness(name: string) {
  const root = mkdtempSync(join(tmpdir(), "cgw-d-"));
  const socketPath = process.platform === "win32"
    ? defaultBrokerEndpoint(root)
    : join(tmpdir(), `cgw-d-${process.pid}-${name.slice(0, 8)}.sock`);
  const broker = TurnBroker.forSocket(socketPath);
  const environment = {
    cwd: root,
    roots: [root],
    writableRoots: [root],
    sandboxPolicy: { type: "dangerFullAccess" as const },
    tools: [],
  };
  return {
    root,
    socketPath,
    broker,
    environment,
    close: async () => {
      await broker.close();
      rmSync(root, { recursive: true, force: true });
    },
  };
}

async function claim(
  socketPath: string,
  token: string,
  activityId: string,
): Promise<{ bindingId: string }> {
  return callTurnBroker<{ bindingId: string }>(socketPath, {
    method: "claim",
    token,
    activityId,
  });
}

async function completeActivity(
  socketPath: string,
  token: string,
  activityId: string,
  activityAbandoned = false,
): Promise<void> {
  await callTurnBroker(socketPath, {
    method: "activity_complete",
    token,
    activityId,
    ...(activityAbandoned ? { activityAbandoned: true } : {}),
  });
}

const sameProcessTimeoutTest = process.platform === "win32" ? test.skip : test;

sameProcessTimeoutTest("unknown timed-out side effect blocks only the identical fingerprint", async () => {
  const h = harness("fingerprint-isolation");
  try {
    const token = await h.broker.register(h.environment, undefined, "deep-fingerprint");
    const firstActivity = "activity_deepfingerprint001";
    const firstClaim = await claim(h.socketPath, token, firstActivity);

    const timedOut = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: firstClaim.bindingId,
      activityId: firstActivity,
      wireName: "exec_command",
      arguments: { cmd: "dangerous-operation", cwd: h.root },
    }, 25);
    const [original] = await h.broker.nextToolBatch(token);
    expect(original).toBeDefined();
    await expect(timedOut).rejects.toThrow("timed out");
    await Bun.sleep(25);
    await completeActivity(h.socketPath, token, firstActivity, true);

    const differentActivity = "activity_deepfingerprint002";
    await claim(h.socketPath, token, differentActivity);
    const different = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: firstClaim.bindingId,
      activityId: differentActivity,
      wireName: "exec_command",
      arguments: { cmd: "safe-different-operation", cwd: h.root },
    }, 1_000);
    const [differentRequest] = await h.broker.nextToolBatch(token);
    expect(differentRequest?.arguments?.cmd).toBe("safe-different-operation");
    h.broker.completeTool(token, differentRequest!.callId, {
      content: [{ type: "text", text: "different completed" }],
    });
    await expect(different).resolves.toMatchObject({
      content: [{ type: "text", text: "different completed" }],
    });
    await completeActivity(h.socketPath, token, differentActivity);

    const duplicateActivity = "activity_deepfingerprint003";
    await claim(h.socketPath, token, duplicateActivity);
    await expect(callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: firstClaim.bindingId,
      activityId: duplicateActivity,
      wireName: "exec_command",
      arguments: { cwd: h.root, cmd: "dangerous-operation" },
    }, 500)).resolves.toMatchObject({
      isError: true,
      structuredContent: { code: "codex_tool_outcome_ambiguous" },
    });
    await completeActivity(h.socketPath, token, duplicateActivity);

    h.broker.completeTool(token, original!.callId, {
      content: [{ type: "text", text: "original eventually completed" }],
    });
  } finally {
    await h.close();
  }
});

sameProcessTimeoutTest("a late result is idempotently replayed inside one recovery activity and expires afterward", async () => {
  const h = harness("late-replay");
  try {
    const token = await h.broker.register(h.environment, undefined, "deep-late-replay");
    const originalActivity = "activity_deeplateoriginal01";
    const originalClaim = await claim(h.socketPath, token, originalActivity);

    const timedOut = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: originalClaim.bindingId,
      activityId: originalActivity,
      wireName: "exec_command",
      arguments: { cmd: "same-side-effect", cwd: h.root },
    }, 25);
    const [originalRequest] = await h.broker.nextToolBatch(token);
    await expect(timedOut).rejects.toThrow("timed out");
    await Bun.sleep(25);
    await completeActivity(h.socketPath, token, originalActivity, true);
    h.broker.completeTool(token, originalRequest!.callId, {
      content: [{ type: "text", text: "cached-native-result" }],
      structuredContent: { recovered: true },
    });

    const recoveryActivity = "activity_deeplaterecover001";
    await claim(h.socketPath, token, recoveryActivity);
    const invokeRecovery = () => callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: originalClaim.bindingId,
      activityId: recoveryActivity,
      wireName: "exec_command",
      arguments: { cwd: h.root, cmd: "same-side-effect" },
    }, 500);

    await expect(invokeRecovery()).resolves.toMatchObject({
      content: [{ type: "text", text: "cached-native-result" }],
      structuredContent: { recovered: true },
    });
    await expect(invokeRecovery()).resolves.toMatchObject({
      content: [{ type: "text", text: "cached-native-result" }],
      structuredContent: { recovered: true },
    });

    const noNativeReplay = new AbortController();
    const timer = setTimeout(() => noNativeReplay.abort(), 40);
    try {
      await expect(h.broker.nextToolBatch(token, noNativeReplay.signal)).rejects.toThrow("tool wait aborted");
    } finally {
      clearTimeout(timer);
    }
    await completeActivity(h.socketPath, token, recoveryActivity);

    const intentionalActivity = "activity_deeplateintent001";
    await claim(h.socketPath, token, intentionalActivity);
    const intentional = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: originalClaim.bindingId,
      activityId: intentionalActivity,
      wireName: "exec_command",
      arguments: { cmd: "same-side-effect", cwd: h.root },
    }, 1_000);
    const [intentionalRequest] = await h.broker.nextToolBatch(token);
    expect(intentionalRequest).toBeDefined();
    h.broker.completeTool(token, intentionalRequest!.callId, {
      content: [{ type: "text", text: "new-native-execution" }],
    });
    await expect(intentional).resolves.toMatchObject({
      content: [{ type: "text", text: "new-native-execution" }],
    });
    await completeActivity(h.socketPath, token, intentionalActivity);
  } finally {
    await h.close();
  }
});

sameProcessTimeoutTest("repeated transport timeouts do not strand activities or prevent completion fencing", async () => {
  const h = harness("timeout-stress");
  try {
    const token = await h.broker.register(h.environment, undefined, "deep-timeout-stress");
    let bindingId = "";

    for (let index = 0; index < 12; index += 1) {
      const activityId = `activity_deepstress${String(index).padStart(4, "0")}abcd`;
      const claimed = await claim(h.socketPath, token, activityId);
      bindingId ||= claimed.bindingId;
      expect(claimed.bindingId).toBe(bindingId);

      const invocation = callTurnBroker(h.socketPath, {
        method: "invoke",
        bindingId,
        activityId,
        wireName: "exec_command",
        arguments: { cmd: `slow-${index}` },
      }, 50);
      const [request] = await h.broker.nextToolBatch(token);
      expect(request?.arguments?.cmd).toBe(`slow-${index}`);
      await expect(invocation).rejects.toThrow("timed out");
      await Bun.sleep(10);
      await completeActivity(h.socketPath, token, activityId, true);

      if (index % 3 === 0) {
        h.broker.completeTool(token, request!.callId, {
          content: [{ type: "text", text: `late-${index}` }],
        });
      }
    }

    expect(h.broker.beginCompletionFence(token)).toBeDefined();

    const finalActivity = "activity_deepstressfinal001";
    await claim(h.socketPath, token, finalActivity);
    const healthy = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId,
      activityId: finalActivity,
      wireName: "exec_command",
      arguments: { cmd: "healthy-final" },
    }, 1_000);
    const [healthyRequest] = await h.broker.nextToolBatch(token);
    h.broker.completeTool(token, healthyRequest!.callId, {
      content: [{ type: "text", text: "healthy" }],
    });
    await expect(healthy).resolves.toMatchObject({
      content: [{ type: "text", text: "healthy" }],
    });
    await completeActivity(h.socketPath, token, finalActivity);
  } finally {
    await h.close();
  }
}, 15_000);

test("explicit turn revocation remains terminal even after timeout-preservation logic", async () => {
  const h = harness("explicit-revoke");
  try {
    const token = await h.broker.register(h.environment, undefined, "deep-explicit-revoke");
    const activityId = "activity_deeprevoke000001";
    const claimed = await claim(h.socketPath, token, activityId);

    const invocation = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      activityId,
      wireName: "exec_command",
      arguments: { cmd: "running-before-cancel" },
    }, 1_000);
    const [request] = await h.broker.nextToolBatch(token);
    expect(request).toBeDefined();

    h.broker.revoke(token, new DOMException("operator cancelled turn", "AbortError"));
    await expect(invocation).rejects.toThrow("operator cancelled turn");
    await expect(callTurnBroker(h.socketPath, {
      method: "claim",
      token,
      activityId: "activity_deeprevoke000002",
    })).rejects.toThrow("already finished");
    expect(() => h.broker.completeTool(token, request!.callId, {
      content: [{ type: "text", text: "must not resurrect" }],
    })).toThrow("invalid or expired");
  } finally {
    await h.close();
  }
});

sameProcessTimeoutTest("parallel identical timeouts stay ambiguous without poisoning unrelated work", async () => {
  const h = harness("parallel-identical");
  try {
    const token = await h.broker.register(h.environment, undefined, "deep-parallel-identical");
    const activityA = "activity_deepparallelA00001";
    const activityB = "activity_deepparallelB00001";
    const activityC = "activity_deepparallelC00001";
    const claimA = await claim(h.socketPath, token, activityA);
    await claim(h.socketPath, token, activityB);

    // Install the outer Codex waiter before starting the MCP calls. The test is about parallel
    // calls that were actually delivered and then lost their consumers, not about scheduler races
    // between queueing and a deliberately short transport deadline.
    const batchPromise = h.broker.nextToolBatch(token);
    const invokeA = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: claimA.bindingId,
      activityId: activityA,
      wireName: "exec_command",
      arguments: { cmd: "same-concurrent-side-effect" },
    }, 150);
    const invokeB = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: claimA.bindingId,
      activityId: activityB,
      wireName: "exec_command",
      arguments: { cmd: "same-concurrent-side-effect" },
    }, 150);
    // Convert the deliberately rejected calls to fulfilled outcome records immediately. Bun can
    // otherwise classify a fast expected rejection as unhandled before a .rejects matcher settles.
    const outcomeA = invokeA.then(
      value => ({ status: "fulfilled" as const, value }),
      error => ({ status: "rejected" as const, error }),
    );
    const outcomeB = invokeB.then(
      value => ({ status: "fulfilled" as const, value }),
      error => ({ status: "rejected" as const, error }),
    );
    const batch = await batchPromise;
    expect(batch).toHaveLength(2);
    const [settledA, settledB] = await Promise.all([outcomeA, outcomeB]);
    expect(settledA.status).toBe("rejected");
    expect(settledB.status).toBe("rejected");
    if (settledA.status === "rejected") expect(String(settledA.error)).toContain("timed out");
    if (settledB.status === "rejected") expect(String(settledB.error)).toContain("timed out");
    await Bun.sleep(25);
    await completeActivity(h.socketPath, token, activityA, true);
    await completeActivity(h.socketPath, token, activityB, true);

    h.broker.completeTool(token, batch[0]!.callId, {
      content: [{ type: "text", text: "late-a" }],
    });
    h.broker.completeTool(token, batch[1]!.callId, {
      content: [{ type: "text", text: "late-b" }],
    });

    await claim(h.socketPath, token, activityC);
    await expect(callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: claimA.bindingId,
      activityId: activityC,
      wireName: "exec_command",
      arguments: { cmd: "same-concurrent-side-effect" },
    }, 500)).resolves.toMatchObject({
      isError: true,
      structuredContent: { code: "codex_tool_outcome_ambiguous" },
    });

    const unrelated = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: claimA.bindingId,
      activityId: activityC,
      wireName: "exec_command",
      arguments: { cmd: "unrelated-after-ambiguity" },
    }, 1_000);
    const [unrelatedRequest] = await h.broker.nextToolBatch(token);
    expect(unrelatedRequest?.arguments?.cmd).toBe("unrelated-after-ambiguity");
    h.broker.completeTool(token, unrelatedRequest!.callId, {
      content: [{ type: "text", text: "unrelated-ok" }],
    });
    await expect(unrelated).resolves.toMatchObject({
      content: [{ type: "text", text: "unrelated-ok" }],
    });
    await completeActivity(h.socketPath, token, activityC);
  } finally {
    await h.close();
  }
});


sameProcessTimeoutTest("MCP timeout cleanup does not publish turn retirement to the browser owner", async () => {
  const h = harness("retirement-signal");
  try {
    const token = await h.broker.register(h.environment, undefined, "deep-retirement-signal");
    const activityId = "activity_deepretirement001";
    const claimed = await claim(h.socketPath, token, activityId);

    const retirementAbort = new AbortController();
    const retirement = h.broker.waitForRetirement(token, retirementAbort.signal);

    // Install the native waiter before starting the short MCP deadline. This scenario is about a
    // call that was definitely delivered and then lost its MCP consumer, not an undelivered queue race.
    const batchPromise = h.broker.nextToolBatch(token);
    const invocation = callTurnBroker(h.socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      activityId,
      wireName: "exec_command",
      arguments: { cmd: "slow-retirement-check" },
    }, 80);
    const invocationTimedOut = expect(invocation).rejects.toThrow("timed out");
    const [request] = await batchPromise;
    await invocationTimedOut;
    await Bun.sleep(40);
    await completeActivity(h.socketPath, token, activityId, true);

    const state = await Promise.race([
      retirement.then(() => "retired", () => "aborted"),
      Bun.sleep(80).then(() => "still-active"),
    ]);
    expect(state).toBe("still-active");

    h.broker.completeTool(token, request!.callId, {
      content: [{ type: "text", text: "late result while turn remains active" }],
    });
    const afterLateResult = await Promise.race([
      retirement.then(() => "retired", () => "aborted"),
      Bun.sleep(80).then(() => "still-active"),
    ]);
    expect(afterLateResult).toBe("still-active");

    retirementAbort.abort();
    await expect(retirement).rejects.toMatchObject({ name: "AbortError" });
  } finally {
    await h.close();
  }
});
