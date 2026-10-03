const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const http = require("node:http");
const { createHash } = require("node:crypto");
const { downloadElectronArtifactZip } = require("app-builder-lib/out/util/electronGet.js");

test("builder downloader preserves checksum validation, caching and cancellation with Fetch", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "builder-download-test-"));
  const payload = Buffer.from("test artifact with a known checksum");
  let requests = 0;
  const server = http.createServer((req, res) => {
    requests++;
    if (req.url === "/stalled") return;
    res.writeHead(200, { "content-length": payload.length });
    res.end(payload);
  });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${server.address().port}`;
  const filename = "electron-v41.10.7-linux-x64.zip";
  const checksum = createHash("sha256").update(payload).digest("hex");
  const options = {
    version: "41.10.7", arch: "x64", platformName: "linux", artifactName: "electron",
    cacheDir: root,
    electronDownload: {
      checksums: { [filename]: checksum },
      mirrorOptions: { resolveAssetURL: async () => `${url}/artifact` },
    },
  };
  try {
    const file = await downloadElectronArtifactZip(options);
    assert.deepEqual(await fs.readFile(file), payload);
    const before = requests;
    assert.equal(await downloadElectronArtifactZip(options), file);
    assert.equal(requests, before, "second download must reuse the verified cache");
    await assert.rejects(downloadElectronArtifactZip({ ...options, cacheDir: path.join(root, "invalid"),
      electronDownload: { ...options.electronDownload, checksums: { [filename]: "0".repeat(64) } },
    }), /checksum/i);
    await assert.rejects(downloadElectronArtifactZip({ ...options, cacheDir: path.join(root, "stalled"),
      electronDownload: { ...options.electronDownload,
        mirrorOptions: { resolveAssetURL: async () => `${url}/stalled` },
        downloadOptions: { signal: AbortSignal.timeout(100) },
      },
    }), /timeout|abort/i);
  } finally {
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    await fs.rm(root, { recursive: true, force: true });
  }
});
