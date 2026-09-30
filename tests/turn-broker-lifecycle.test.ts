import { expect, test } from "bun:test";
import { ChatGptTextFeed, ChatGptTraceFeed, ChatGptTurnSessions } from "../src/adapters/chatgpt-web/turn-execution";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { callTurnBroker, TurnBroker } from "../src/adapters/chatgpt-web/turn-broker";
import { defaultBrokerEndpoint, isWindowsPipeEndpoint } from "../src/config";

test.skipIf(process.platform === "win32")("closing a rejected broker leaves the live socket reachable", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-owner-"));
  const endpoint = join(root, "broker.sock");
  const server = createServer(socket => {
    socket.once("data", bytes => {
      const request = JSON.parse(bytes.toString().trim());
      socket.end(JSON.stringify({ id: request.id, result: { ready: true } }) + "\n");
    });
  });
  const contender = TurnBroker.forSocket(endpoint);
  try {
    await new Promise<void>(resolve => server.listen(endpoint, resolve));
    chmodSync(endpoint, 0o600);
    await expect(contender.listen()).rejects.toThrow("already owned by another process");
    await contender.close();
    await contender.close();
    expect(existsSync(endpoint)).toBeTrue();
    expect(await callTurnBroker<{ ready: boolean }>(endpoint, { method: "owner_status" })).toEqual({ ready: true });
  } finally {
    await contender.close();
    await new Promise<void>(resolve => server.close(() => resolve()));
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicit browser-turn cancellation aborts and removes every registered session", async () => {
  const sessions = new ChatGptTurnSessions();
  let cancelled = 0;
  const replayable = sessions.getOrCreate("turn-a", () => ({
    mode: "read-only",
    browser: Promise.resolve("done"),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  }));
  await replayable.browserOutcome;
  sessions.getOrCreate("turn-b", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  }));

  expect(sessions.activeCount()).toBe(1);
  expect(sessions.clear()).toBe(2);
  expect(cancelled).toBe(2);
  expect(sessions.activeCount()).toBe(0);
});

test("targeted tab cancellation settles one trace and keeps a terminal replay tombstone", async () => {
  const sessions = new ChatGptTurnSessions();
  let rejectTarget!: (error: Error) => void;
  let targetCancelled = 0;
  let otherCancelled = 0;
  const target = sessions.getOrCreate("target", () => ({
    mode: "read-only",
    browser: new Promise<string>((_resolve, reject) => { rejectTarget = reject; }),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => {
      targetCancelled += 1;
      rejectTarget(new Error("browser tab closed by user"));
    },
  }), "trace_target");
  sessions.getOrCreate("other", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { otherCancelled += 1; },
  }), "trace_other");

  expect(await sessions.cancelTrace("trace_target")).toBe(1);
  expect(targetCancelled).toBe(1);
  expect(otherCancelled).toBe(0);
  expect(target.settledOutcome()).toMatchObject({ type: "error" });
  expect(sessions.activeCount()).toBe(1);
  expect(sessions.getOrCreate("target", () => {
    throw new Error("a cancelled continuation must not open a new browser tab");
  }, "trace_target")).toBe(target);
  expect(await sessions.cancelTrace("trace_target")).toBe(0);
  sessions.clear();
});

test("native interruption retires only the exact browser turn identity", async () => {
  const sessions = new ChatGptTurnSessions();
  const cancelled: string[] = [];
  const runtime = (name: string) => {
    let rejectBrowser!: (error: Error) => void;
    const browser = new Promise<string>((_resolve, reject) => { rejectBrowser = reject; });
    return {
      mode: "read-only" as const,
      browser,
      physicalSettlement: browser.then(() => undefined, () => undefined),
      trace: new ChatGptTraceFeed(),
      text: new ChatGptTextFeed(),
      cancel: (reason?: Error) => {
        cancelled.push(name);
        rejectBrowser(reason ?? new Error("cancelled"));
      },
    };
  };
  sessions.getOrCreate(
    "target",
    () => runtime("target"),
    "trace_target",
    "owner_target",
    "turn_shared",
    "thread_target",
  );
  sessions.getOrCreate(
    "other-thread",
    () => runtime("other-thread"),
    "trace_other",
    "owner_other",
    "turn_shared",
    "thread_other",
  );

  const cancellation = sessions.cancelNativeTurn(
    "thread_target",
    "turn_shared",
    new DOMException("Codex turn interrupted", "AbortError"),
  );
  expect(cancellation.cancelled).toBe(1);
  await cancellation.settlement;
  expect(cancelled).toEqual(["target"]);
  expect(sessions.find("target")).toBeUndefined();
  expect(sessions.find("other-thread")?.nativeThreadId).toBe("thread_other");
  expect(sessions.activeCount()).toBe(1);
  sessions.clear();
});

test("session cache expiry never cancels a still-active long browser turn", async () => {
  const sessions = new ChatGptTurnSessions(1);
  let cancelled = 0;
  const active = sessions.getOrCreate("long-turn", () => ({
    mode: "read-only",
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  }));

  await Bun.sleep(5);
  expect(sessions.activeCount()).toBe(1);
  expect(sessions.getOrCreate("long-turn", () => {
    throw new Error("active session must be reused");
  })).toBe(active);
  expect(cancelled).toBe(0);
  sessions.clear();
});

test("five active turns coexist and a sixth fails closed", () => {
  const sessions = new ChatGptTurnSessions();
  let cancelled = 0;
  const runtime = () => ({
    mode: "read-only" as const,
    browser: new Promise<string>(() => {}),
    physicalSettlement: Promise.resolve(),
    trace: new ChatGptTraceFeed(),
    text: new ChatGptTextFeed(),
    cancel: () => { cancelled += 1; },
  });

  const active = Array.from({ length: 5 }, (_unused, index) => (
    sessions.getOrCreate(`turn-${index + 1}`, runtime)
  ));
  expect(sessions.activeCount()).toBe(5);
  expect(cancelled).toBe(0);
  expect(() => sessions.getOrCreate("turn-6", runtime)).toThrow("at most 5 simultaneous browser turns");

  expect(sessions.getOrCreate("turn-3", () => {
    throw new Error("an in-flight turn must be reused");
  })).toBe(active[2]);
  expect(cancelled).toBe(0);
  sessions.clear();
  expect(cancelled).toBe(5);
});

test("async session creation waits for physical browser cleanup instead of failing at capacity", async () => {
  const sessions = new ChatGptTurnSessions();
  const resolveBrowser = new Map<string, (value: string) => void>();
  const resolvePhysical = new Map<string, () => void>();
  let starts = 0;

  const runtime = (name: string) => {
    starts += 1;
    const browser = new Promise<string>(resolve => resolveBrowser.set(name, resolve));
    const physicalSettlement = new Promise<void>(resolve => resolvePhysical.set(name, resolve));
    return {
      mode: "read-only" as const,
      browser,
      physicalSettlement,
      trace: new ChatGptTraceFeed(),
      text: new ChatGptTextFeed(),
      cancel: () => {
        resolveBrowser.get(name)?.("cancelled");
        resolvePhysical.get(name)?.();
      },
    };
  };

  for (let index = 1; index <= 5; index += 1) {
    sessions.getOrCreate(
      `turn-${index}`,
      () => runtime(`turn-${index}`),
      `trace-${index}`,
      `owner-${index}`,
    );
  }
  expect(starts).toBe(5);

  let sixthStarted = false;
  const sixth = sessions.getOrCreateAfterOwnerRetirement(
    "turn-6",
    "owner-6",
    () => {
      sixthStarted = true;
      return runtime("turn-6");
    },
    "trace-6",
  );

  await Bun.sleep(5);
  expect(sixthStarted).toBeFalse();

  // A semantic answer alone is not enough: the worker still owns the browser tab until its
  // physical cleanup settles.
  resolveBrowser.get("turn-1")?.("done");
  await Bun.sleep(5);
  expect(sixthStarted).toBeFalse();

  resolvePhysical.get("turn-1")?.();
  await sixth;
  expect(sixthStarted).toBeTrue();
  expect(starts).toBe(6);

  sessions.clear();
});

test("settled replay sessions expire from their last use instead of their creation time", async () => {
  const sessions = new ChatGptTurnSessions(50);
  let starts = 0;
  const start = () => {
    starts += 1;
    return {
      mode: "read-only" as const,
      browser: Promise.resolve("done"),
      physicalSettlement: Promise.resolve(),
      trace: new ChatGptTraceFeed(),
      text: new ChatGptTextFeed(),
      cancel: () => {},
    };
  };
  const first = sessions.getOrCreate("replay", start);
  await first.browserOutcome;
  await Bun.sleep(10);
  expect(sessions.getOrCreate("replay", start)).toBe(first);
  await Bun.sleep(70);
  expect(sessions.getOrCreate("replay", start)).not.toBe(first);
  expect(starts).toBe(2);
  sessions.clear();
});

test("turn broker creates its private runtime directory on a cold start", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 10_000);
    if (process.platform === "win32") {
      expect(isWindowsPipeEndpoint(socketPath)).toBe(true);
    } else {
      expect(existsSync(socketPath)).toBe(true);
      expect(statSync(dirname(socketPath)).mode & 0o777).toBe(0o700);
    }
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("turn broker rejects a Unix socket path that leaves no room for sun_path's NUL terminator", async () => {
  if (process.platform === "win32") return;
  const socketPath = `/tmp/${"x".repeat(99)}`;
  expect(Buffer.byteLength(socketPath)).toBe(104);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    await expect(broker.listen()).rejects.toThrow("103-byte limit");
  } finally {
    await broker.close();
  }
});

test("turn broker tokens do not expire while their browser turn is still alive", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-unbounded-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    });
    await Bun.sleep(5);
    await expect(callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token }))
      .resolves.toMatchObject({ bindingId: expect.any(String) });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("turn broker revokes only channels owned by the closed browser trace", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-targeted-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const environment = {
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" as const },
      tools: [],
    };
    const target = await broker.register(environment, 60_000, "trace_target");
    const other = await broker.register(environment, 60_000, "trace_other");
    expect(broker.revokeTrace("trace_target")).toBe(1);
    await expect(callTurnBroker(socketPath, { method: "claim", token: target }))
      .rejects.toThrow("already finished");
    await expect(callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token: other }))
      .resolves.toMatchObject({ bindingId: expect.any(String) });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

function unansweredBrokerEndpoint(name: string, onConnection: (socket: Socket) => void) {
  const root = mkdtempSync(join(tmpdir(), name));
  const socketPath = defaultBrokerEndpoint(root);
  if (!isWindowsPipeEndpoint(socketPath)) mkdirSync(dirname(socketPath), { recursive: true });
  const server = createServer(onConnection);
  return {
    socketPath,
    listen: () => new Promise<void>(ready => server.listen(socketPath, ready)),
    close: async () => {
      await new Promise<void>(done => server.close(() => done()));
      rmSync(root, { recursive: true, force: true });
    },
  };
}

test("an unbounded broker call fails when the broker closes without answering", async () => {
  const broker = unansweredBrokerEndpoint("cgw-broker-closed-", socket => socket.on("data", () => socket.end()));
  await broker.listen();
  try {
    await expect(callTurnBroker(broker.socketPath, { method: "claim", token: "turn_closed" }, null))
      .rejects.toThrow("closed the connection");
  } finally {
    await broker.close();
  }
}, 10_000);

test("bounded broker calls preserve server-owned closure before advancing the lifecycle", async () => {
  let peer!: Socket;
  let finishFrame!: () => void;
  const frameWritten = new Promise<void>(resolve => { finishFrame = resolve; });
  const broker = unansweredBrokerEndpoint("cgw-broker-frame-", socket => {
    peer = socket;
    socket.once("data", chunk => {
      const request = JSON.parse(chunk.toString().trim());
      const frame = JSON.stringify({ id: request.id, result: { ready: true } }) + "\n";
      socket.write(frame.slice(0, -1));
      setImmediate(() => { socket.write(frame.slice(-1)); finishFrame(); });
    });
  });
  await broker.listen();
  try {
    let settled = false;
    const call = callTurnBroker(broker.socketPath, { method: "owner_status" }).then(result => {
      settled = true;
      return result;
    });
    await frameWritten;
    await Bun.sleep(25);
    expect(settled).toBeFalse();
    peer.end();
    await expect(call).resolves.toEqual({ ready: true });
  } finally {
    peer?.destroy();
    await broker.close();
  }
});

test("broker frame settlement still rejects errors, wrong identities and incomplete replies", async () => {
  for (const [reply, expected] of [
    [(id: string) => JSON.stringify({ id, error: "claim rejected" }) + "\n", "claim rejected"],
    [() => '{"id":"another","result":true}\n', "response id mismatch"],
    [() => 'null\n', "invalid response frame"],
    [(id: string) => JSON.stringify({ id, result: true, error: "contradiction" }) + "\n", "invalid response frame"],
    [(id: string) => JSON.stringify({ id }), "closed the connection"],
    [() => '{broken}\n', "invalid JSON"],
  ] as const) {
    const broker = unansweredBrokerEndpoint("cgw-broker-reject-", socket => {
      socket.once("data", chunk => socket.end(reply(JSON.parse(chunk.toString().trim()).id)));
    });
    await broker.listen();
    try {
      await expect(callTurnBroker(broker.socketPath, { method: "owner_status" })).rejects.toThrow(expected);
    } finally { await broker.close(); }
  }
});

test("an unbounded broker call outlives the bounded default timeout", async () => {
  const accepted: Socket[] = [];
  const broker = unansweredBrokerEndpoint("cgw-broker-slow-", socket => { accepted.push(socket); });
  await broker.listen();
  try {
    const call = callTurnBroker(broker.socketPath, { method: "claim", token: "turn_unbounded" }, null);
    const outcome = await Promise.race([
      call.then(() => "settled", () => "settled"),
      Bun.sleep(5_300).then(() => "pending"),
    ]);
    expect(outcome).toBe("pending");
  } finally {
    for (const socket of accepted) socket.destroy();
    await broker.close();
  }
}, 15_000);

test("turn broker names the finished turn that owns a replayed handle", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-broker-"));
  const socketPath = defaultBrokerEndpoint(root);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, 60_000, "turn-alpha");
    await expect(callTurnBroker(socketPath, { method: "claim", token: ` ${token}` }))
      .rejects.toThrow("turn token is invalid, expired, or revoked");
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, { method: "claim", token });
    broker.revoke(token);

    const rejection = async (request: Parameters<typeof callTurnBroker>[1]): Promise<string> => {
      try {
        await callTurnBroker(socketPath, request);
      } catch (error) {
        return error instanceof Error ? error.message : String(error);
      }
      throw new Error("turn broker accepted a handle it should have rejected");
    };

    const replayedBinding = await rejection({
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
    });
    expect(replayedBinding).toContain("turn-alpha");
    expect(replayedBinding).toContain("has already finished");
    expect(replayedBinding).not.toContain("codex_bind_turn");

    const replayedToken = await rejection({ method: "claim", token });
    expect(replayedToken).toContain("turn-alpha");
    expect(replayedToken).toContain("can no longer run");
    expect(replayedToken).not.toContain("current task context");

    const unknownBinding = await rejection({
      method: "invoke",
      bindingId: "binding_never-issued",
      wireName: "exec_command",
    });
    expect(unknownBinding).toBe("internal Codex turn binding is invalid or expired");
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("timed-out MCP invocation retires only that invocation and keeps the browser turn capability alive", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-inv-"));
  const socketPath = process.platform === "win32"
    ? defaultBrokerEndpoint(root)
    : join(tmpdir(), `cgw-inv-${process.pid}.sock`);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "long-browser-turn");
    const activityId = "activity_timeoutcleanup1234567890";
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId,
    });

    const invocation = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
      arguments: { cmd: "long-running-command" },
    }, 25);
    const [request] = await broker.nextToolBatch(token);
    expect(request?.wireName).toBe("exec_command");
    await expect(invocation).rejects.toThrow("timed out");

    await Bun.sleep(25);
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId,
    });

    expect(broker.beginCompletionFence(token)).toBeDefined();
    await expect(callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId: "activity_aftertimeout1234567890",
    })).resolves.toMatchObject({ bindingId: claimed.bindingId });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("late native result after MCP timeout is ignored without poisoning the surviving turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-late-"));
  const socketPath = process.platform === "win32"
    ? defaultBrokerEndpoint(root)
    : join(tmpdir(), `cgw-late-${process.pid}.sock`);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "late-result-turn");
    const activityId = "activity_lateresult1234567890";
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId,
    });

    const invocation = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
      arguments: { cmd: "slow-command" },
    }, 25);
    const [request] = await broker.nextToolBatch(token);
    expect(request).toBeDefined();

    await expect(invocation).rejects.toThrow("timed out");
    expect(broker.beginCompletionFence(token)).toBeUndefined();

    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId,
    });
    expect(broker.beginCompletionFence(token)).toBeDefined();

    expect(() => broker.completeTool(token, request!.callId, {
      content: [{ type: "text", text: "late native result" }],
    })).not.toThrow();
    expect(() => broker.completeTool(token, "call_unknown_late_result", {
      content: [{ type: "text", text: "unknown" }],
    })).toThrow("tool call is not pending");

    const nextActivity = "activity_afterlate1234567890";
    await expect(callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId: nextActivity,
    })).resolves.toMatchObject({ bindingId: claimed.bindingId });
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: nextActivity,
    });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});

test("timed-out undelivered MCP invocation is removed from the next tool batch", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-undel-"));
  const socketPath = process.platform === "win32"
    ? defaultBrokerEndpoint(root)
    : join(tmpdir(), `cgw-undel-${process.pid}.sock`);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "undelivered-timeout");
    const activityId = "activity_undelivered1234567890";
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId,
    });

    await expect(callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
      arguments: { cmd: "never-delivered" },
    }, 25)).rejects.toThrow("timed out");
    // The client timeout destroys its socket; allow the broker close event to retire the queued
    // invocation before asking for the next batch.
    await Bun.sleep(25);

    const waitAbort = new AbortController();
    const timer = setTimeout(() => waitAbort.abort(), 40);
    try {
      await expect(broker.nextToolBatch(token, waitAbort.signal)).rejects.toThrow("tool wait aborted");
    } finally {
      clearTimeout(timer);
    }

    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId,
    });
    expect(broker.beginCompletionFence(token)).toBeDefined();
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("one timed-out MCP invocation does not cancel a parallel sibling on the same turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-par-"));
  const socketPath = process.platform === "win32"
    ? defaultBrokerEndpoint(root)
    : join(tmpdir(), `cgw-par-${process.pid}.sock`);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "parallel-timeout-turn");
    const firstActivity = "activity_parallelfirst1234567890";
    const secondActivity = "activity_parallelsecond123456789";
    const firstClaim = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim", token, activityId: firstActivity,
    });
    const secondClaim = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim", token, activityId: secondActivity,
    });
    expect(secondClaim.bindingId).toBe(firstClaim.bindingId);

    const timedOut = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: firstClaim.bindingId,
      wireName: "exec_command",
      arguments: { cmd: "slow-first" },
    }, 25);
    const survivor = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: secondClaim.bindingId,
      wireName: "exec_command",
      arguments: { cmd: "fast-second" },
    }, 2_000);

    const batch = await broker.nextToolBatch(token);
    expect(batch).toHaveLength(2);
    const first = batch.find(request => request.arguments?.cmd === "slow-first");
    const second = batch.find(request => request.arguments?.cmd === "fast-second");
    expect(first).toBeDefined();
    expect(second).toBeDefined();

    await expect(timedOut).rejects.toThrow("timed out");
    await Bun.sleep(25);
    broker.completeTool(token, second!.callId, {
      content: [{ type: "text", text: "second completed" }],
    });
    await expect(survivor).resolves.toMatchObject({
      content: [{ type: "text", text: "second completed" }],
    });

    await callTurnBroker(socketPath, {
      method: "activity_complete", token, activityId: firstActivity,
    });
    await callTurnBroker(socketPath, {
      method: "activity_complete", token, activityId: secondActivity,
    });
    expect(broker.beginCompletionFence(token)).toBeDefined();

    expect(() => broker.completeTool(token, first!.callId, {
      content: [{ type: "text", text: "first completed late" }],
    })).not.toThrow();
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("an unresolved timed-out invocation cannot be replayed as an identical native side effect", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-amb-"));
  const socketPath = process.platform === "win32"
    ? defaultBrokerEndpoint(root)
    : join(tmpdir(), `cgw-amb-${process.pid}.sock`);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "ambiguous-timeout-turn");
    const firstActivity = "activity_ambiguousfirst123456789";
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId: firstActivity,
    });

    const first = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
      arguments: { cmd: "perform-side-effect", cwd: root },
    }, 25);
    const [firstRequest] = await broker.nextToolBatch(token);
    expect(firstRequest).toBeDefined();
    await expect(first).rejects.toThrow("timed out");
    await Bun.sleep(25);
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: firstActivity,
    });

    const secondActivity = "activity_ambiguoussecond12345678";
    await callTurnBroker(socketPath, {
      method: "claim",
      token,
      activityId: secondActivity,
    });
    const duplicate = callTurnBroker<{
      content: unknown[];
      structuredContent?: unknown;
      isError?: boolean;
    }>(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
      arguments: { cwd: root, cmd: "perform-side-effect" },
    }, 500);

    const waitAbort = new AbortController();
    const timer = setTimeout(() => waitAbort.abort(), 50);
    try {
      await expect(broker.nextToolBatch(token, waitAbort.signal)).rejects.toThrow("tool wait aborted");
    } finally {
      clearTimeout(timer);
    }
    await expect(duplicate).resolves.toMatchObject({
      isError: true,
      structuredContent: {
        code: "codex_tool_outcome_ambiguous",
        retryable: false,
      },
    });

    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: secondActivity,
    });
    // Once the original native operation reports its eventual result, the ambiguity is cleared.
    expect(() => broker.completeTool(token, firstRequest!.callId, {
      content: [{ type: "text", text: "original completed late" }],
    })).not.toThrow();

    const thirdActivity = "activity_ambiguousthird123456789";
    await callTurnBroker(socketPath, {
      method: "claim",
      token,
      activityId: thirdActivity,
    });
    const retry = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      wireName: "exec_command",
      arguments: { cmd: "perform-side-effect", cwd: root },
    }, 2_000);
    const [retryRequest] = await broker.nextToolBatch(token);
    expect(retryRequest).toBeDefined();
    broker.completeTool(token, retryRequest!.callId, {
      content: [{ type: "text", text: "retry completed" }],
    });
    await expect(retry).resolves.toMatchObject({
      content: [{ type: "text", text: "retry completed" }],
    });
    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId: thirdActivity,
    });
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});


test("activity completion abandons its delivered invocation without waiting for socket-close cleanup", async () => {
  const root = mkdtempSync(join(tmpdir(), "cgw-act-"));
  const socketPath = process.platform === "win32"
    ? defaultBrokerEndpoint(root)
    : join(tmpdir(), `cgw-act-${process.pid}.sock`);
  const broker = TurnBroker.forSocket(socketPath);
  try {
    const token = await broker.register({
      cwd: root,
      roots: [root],
      writableRoots: [root],
      sandboxPolicy: { type: "dangerFullAccess" },
      tools: [],
    }, undefined, "activity-cleanup-turn");
    const activityId = "activity_cleanupowner12345678901";
    const claimed = await callTurnBroker<{ bindingId: string }>(socketPath, {
      method: "claim",
      token,
      activityId,
    });

    const invocation = callTurnBroker(socketPath, {
      method: "invoke",
      bindingId: claimed.bindingId,
      activityId,
      wireName: "exec_command",
      arguments: { cmd: "slow-owner-call" },
    }, 2_000);
    const [request] = await broker.nextToolBatch(token);
    expect(request).toBeDefined();

    await callTurnBroker(socketPath, {
      method: "activity_complete",
      token,
      activityId,
    });
    expect(broker.beginCompletionFence(token)).toBeDefined();

    await expect(invocation).rejects.toThrow("activity completed");
    expect(() => broker.completeTool(token, request!.callId, {
      content: [{ type: "text", text: "late result" }],
    })).not.toThrow();
  } finally {
    await broker.close();
    rmSync(root, { recursive: true, force: true });
  }
});
