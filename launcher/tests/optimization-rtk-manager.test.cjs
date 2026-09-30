const test = require("node:test");
const assert = require("node:assert/strict");
const {
  checksumFor,
  rtkAssetName,
  verifyRtkBinary,
} = require("../electron/optimization/rtk-manager.cjs");

test("RTK release assets are resolved without modifying PATH or Codex", () => {
  assert.equal(rtkAssetName("win32", "x64"), "rtk-x86_64-pc-windows-msvc.zip");
  assert.equal(rtkAssetName("darwin", "arm64"), "rtk-aarch64-apple-darwin.tar.gz");
  assert.equal(rtkAssetName("darwin", "x64"), "rtk-x86_64-apple-darwin.tar.gz");
  assert.equal(rtkAssetName("linux", "x64"), "rtk-x86_64-unknown-linux-musl.tar.gz");
  assert.equal(rtkAssetName("freebsd", "x64"), null);
});

test("RTK checksum parser selects the exact release asset", () => {
  const sum = "a".repeat(64);
  assert.equal(checksumFor(`${sum}  rtk-x86_64-pc-windows-msvc.zip\n`, "rtk-x86_64-pc-windows-msvc.zip"), sum);
  assert.throws(() => checksumFor(`${sum}  other.zip\n`, "rtk.zip"), /do not contain/);
});

test("RTK binary health check requires the expected version", () => {
  const ok = (_exe, _args, _options) => ({ status: 0, stdout: "rtk 0.50.0\n", stderr: "" });
  assert.match(verifyRtkBinary("rtk", "0.50.0", ok), /0\.50\.0/);
  const wrong = () => ({ status: 0, stdout: "rtk 0.49.0\n", stderr: "" });
  assert.throws(() => verifyRtkBinary("rtk", "0.50.0", wrong), /unexpected version/);
  const failed = () => ({ status: 2, stdout: "", stderr: "boom" });
  assert.throws(() => verifyRtkBinary("rtk", "0.50.0", failed), /health check failed/);
});
