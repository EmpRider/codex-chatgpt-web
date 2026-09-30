const test = require("node:test");
const assert = require("node:assert/strict");
const {
  HeadroomService,
  headroomExtras,
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
    lastError: null,
  });
});
