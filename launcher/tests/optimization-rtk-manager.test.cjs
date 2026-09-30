const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  checksumFor,
  installRtkRelease,
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

test("RTK installer retains verified source and license metadata", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rtk-manager-test-"));
  const assetName = "rtk-x86_64-pc-windows-msvc.zip";
  const sum = "b".repeat(64);
  try {
    const result = await installRtkRelease({
      root,
      release: {
        tag_name: "v0.50.0",
        assets: [
          { name: assetName, browser_download_url: "https://example.invalid/rtk.zip" },
          { name: "checksums.txt", browser_download_url: "https://example.invalid/checksums.txt" },
        ],
      },
      platform: "win32",
      arch: "x64",
      licenseContent: "Apache License",
      dependencies: {
        downloadFile: async (_url, destination) => fs.writeFileSync(destination, "archive"),
        downloadText: async () => `${sum}  ${assetName}\n`,
        sha256: () => sum,
        extractArchive: (_archive, destination) => {
          fs.mkdirSync(destination, { recursive: true });
          fs.writeFileSync(path.join(destination, "rtk.exe"), "binary");
        },
        verifyBinary: () => "rtk 0.50.0",
      },
    });
    assert.equal(result.version, "0.50.0");
    assert.equal(fs.readFileSync(path.join(result.path, "LICENSE"), "utf8"), "Apache License\n");
    assert.match(fs.readFileSync(path.join(result.path, "checksums.txt"), "utf8"), /rtk-x86_64-pc-windows-msvc\.zip/);
    const source = JSON.parse(fs.readFileSync(path.join(result.path, "source.json"), "utf8"));
    assert.equal(source.repository, "rtk-ai/rtk");
    assert.equal(source.release, "v0.50.0");
    assert.equal(source.sha256, sum);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
