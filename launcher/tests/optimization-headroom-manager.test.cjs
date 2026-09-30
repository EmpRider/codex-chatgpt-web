const test = require("node:test");
const assert = require("node:assert/strict");
const {
  headroomExtras,
  uvAssetName,
  venvExecutables,
} = require("../electron/optimization/headroom-manager.cjs");

test("private uv runtime resolves supported packaged platforms", () => {
  assert.equal(uvAssetName("win32", "x64"), "uv-x86_64-pc-windows-msvc.zip");
  assert.equal(uvAssetName("darwin", "arm64"), "uv-aarch64-apple-darwin.tar.gz");
  assert.equal(uvAssetName("linux", "x64"), "uv-x86_64-unknown-linux-musl.tar.gz");
  assert.equal(uvAssetName("win32", "arm64"), null);
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
