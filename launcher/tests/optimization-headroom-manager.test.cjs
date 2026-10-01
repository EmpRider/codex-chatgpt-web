const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HeadroomService,
  findAvailableHeadroomPort,
  headroomExtras,
  isHeadroomHealth,
  uvAssetName,
  venvExecutables,
  verifyVersionCommand,
} = require("../electron/optimization/headroom-manager.cjs");

test("private uv runtime resolves supported packaged platforms", () => {
  assert.equal(uvAssetName("win32", "x64"), "uv-x86_64-pc-windows-msvc.zip");
  assert.equal(uvAssetName("win32", "arm64"), "uv-aarch64-pc-windows-msvc.zip");
  assert.equal(uvAssetName("darwin", "arm64"), "uv-aarch64-apple-darwin.tar.gz");
  assert.equal(uvAssetName("linux", "x64"), "uv-x86_64-unknown-linux-musl.tar.gz");
  assert.equal(uvAssetName("linux", "arm64"), "uv-aarch64-unknown-linux-gnu.tar.gz");
});

test("Headroom extras are selected by GUI features", () => {
  assert.deepEqual(headroomExtras({ codeEnabled: false, mlEnabled: false }), ["proxy"]);
  assert.deepEqual(headroomExtras({ codeEnabled: true, mlEnabled: false }), ["proxy", "code"]);
  assert.deepEqual(headroomExtras({ codeEnabled: true, mlEnabled: true }), ["proxy", "code", "ml"]);
});

test("Headroom venv paths stay private and platform-specific", () => {
  assert.match(venvExecutables("C:/private", "win32").headroom, /Scripts[\\/]headroom\.exe$/);
  assert.match(venvExecutables("/private", "linux").python, /bin[\\/]python$/);
});

test("private runtime version verification rejects stale binaries", () => {
  const ok = () => ({ status: 0, stdout: "uv 0.8.20\n", stderr: "" });
  assert.match(verifyVersionCommand("uv", "0.8.20", ok), /0\.8\.20/);
  const stale = () => ({ status: 0, stdout: "uv 0.8.19\n", stderr: "" });
  assert.throws(() => verifyVersionCommand("uv", "0.8.20", stale), /unexpected version/);
  const failed = () => ({ status: 1, stdout: "", stderr: "broken" });
  assert.throws(() => verifyVersionCommand("uv", "0.8.20", failed), /health check failed/);
});

test("Headroom service state distinguishes installed runtime from live process", () => {
  const service = new HeadroomService({ root: process.cwd(), logger: null });
  assert.deepEqual(service.state(), {
    running: false,
    ready: false,
    port: null,
    preferredPort: null,
    portConflict: false,
    lastError: null,
  });
});

test("Headroom uses only the configured loopback port", async () => {
  const checked = [];
  const selected = await findAvailableHeadroomPort(8787, {
    canBind: async (port) => {
      checked.push(port);
      return true;
    },
  });
  assert.equal(selected, 8787);
  assert.deepEqual(checked, [8787]);
});

test("Headroom tells the user to change the configured port when it is occupied", async () => {
  await assert.rejects(
    () => findAvailableHeadroomPort(8787, { canBind: async () => false }),
    /Headroom port 8787 is already in use\. Change the Headroom port in Settings and try again\./,
  );
});

test("Headroom health identity rejects generic readiness payloads", () => {
  assert.equal(isHeadroomHealth({ ready: true }), false);
  assert.equal(isHeadroomHealth({ service: "another-service", ready: true }), false);
  assert.equal(isHeadroomHealth({ service: "headroom-proxy", ready: true }), true);
  assert.equal(isHeadroomHealth({ service: "headroom-proxy", status: "healthy" }), true);
});

test("Headroom reuses an already healthy service on the configured port", async () => {
  let resolverCalled = false;
  const service = new HeadroomService({
    root: process.cwd(),
    logger: null,
    portResolver: async () => {
      resolverCalled = true;
      throw new Error("must not resolve a new port");
    },
    healthCheck: async (port, route) => {
      assert.equal(port, 8787);
      assert.equal(route, "/readyz");
      return { service: "headroom-proxy", ready: true };
    },
  });

  const health = await service.start({
    executable: "unused-headroom",
    port: 8787,
    codeEnabled: true,
    mlEnabled: false,
  });

  assert.deepEqual(health, { service: "headroom-proxy", status: "healthy", alive: true });
  assert.equal(resolverCalled, false);
  assert.deepEqual(service.state(), {
    running: true,
    ready: true,
    port: 8787,
    preferredPort: 8787,
    portConflict: false,
    lastError: null,
  });
});


test("Headroom does not reuse an unrelated healthy service on the configured port", async () => {
  let resolverCalled = false;
  const service = new HeadroomService({
    root: process.cwd(),
    logger: null,
    portResolver: async () => {
      resolverCalled = true;
      throw new Error("Headroom port 8787 is already in use. Change the Headroom port in Settings and try again.");
    },
    healthCheck: async () => ({ service: "another-service", ready: true }),
  });

  await assert.rejects(
    () => service.start({
      executable: "unused-headroom",
      port: 8787,
      codeEnabled: true,
      mlEnabled: false,
    }),
    /Headroom port 8787 is already in use/,
  );
  assert.equal(resolverCalled, true);
  assert.equal(service.state().ready, false);
});
