const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const USER_AGENT = "codex-web-gpt-rtk-manager";

function rtkAssetName(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") return "rtk-x86_64-pc-windows-msvc.zip";
  if (platform === "darwin" && arch === "x64") return "rtk-x86_64-apple-darwin.tar.gz";
  if (platform === "darwin" && arch === "arm64") return "rtk-aarch64-apple-darwin.tar.gz";
  if (platform === "linux" && arch === "x64") return "rtk-x86_64-unknown-linux-musl.tar.gz";
  if (platform === "linux" && arch === "arm64") return "rtk-aarch64-unknown-linux-gnu.tar.gz";
  return null;
}

function checksumFor(text, name) {
  for (const line of String(text || "").split(/\r?\n/)) {
    const match = /^([a-fA-F0-9]{64})\s+[*]?(.+)$/.exec(line.trim());
    if (match && match[2] === name) return match[1].toLowerCase();
  }
  throw new Error(`RTK checksums do not contain ${name}`);
}

function fileSha256(filePath) {
  const hash = crypto.createHash("sha256");
  const fd = fs.openSync(filePath, "r");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (;;) {
      const count = fs.readSync(fd, buffer, 0, buffer.length, null);
      if (!count) break;
      hash.update(buffer.subarray(0, count));
    }
  } finally {
    fs.closeSync(fd);
  }
  return hash.digest("hex");
}

function request(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many RTK download redirects"));
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return reject(new Error("RTK downloads require HTTPS"));
    const req = https.get(parsed, { headers: { "User-Agent": USER_AGENT } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        request(new URL(response.headers.location, parsed).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`RTK download failed with HTTP ${response.statusCode}`));
        return;
      }
      resolve(response);
    });
    req.setTimeout(60_000, () => req.destroy(new Error("RTK download timed out")));
    req.once("error", reject);
  });
}

async function downloadText(url, maxBytes = 2 * 1024 * 1024) {
  const response = await request(url);
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("RTK metadata exceeded size limit");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function downloadFile(url, destination) {
  const response = await request(url);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
    response.pipe(output);
    output.once("finish", resolve);
    output.once("error", reject);
    response.once("error", reject);
  });
}

function extractArchive(archivePath, destination, platform = process.platform) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  let result = spawnSync("tar", ["-xf", archivePath, "-C", destination], {
    encoding: "utf8",
    timeout: 60_000,
    windowsHide: true,
  });
  if (result.status === 0) return;
  if (platform === "win32" && archivePath.endsWith(".zip")) {
    result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      archivePath, destination,
    ], { encoding: "utf8", timeout: 60_000, windowsHide: true });
    if (result.status === 0) return;
  }
  throw new Error(`Could not extract RTK archive: ${String(result.stderr || result.error || "unknown error").trim()}`);
}

function findRtkBinary(root, platform = process.platform) {
  const expected = platform === "win32" ? "rtk.exe" : "rtk";
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && entry.name === expected) return candidate;
    }
  }
  throw new Error("RTK archive did not contain the expected executable");
}

function verifyRtkBinary(executable, expectedVersion, runner = spawnSync) {
  const result = runner(executable, ["--version"], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (result?.error) throw result.error;
  if (result?.status !== 0) {
    throw new Error(`RTK health check failed with exit ${result?.status ?? "unknown"}`);
  }
  const output = `${result?.stdout || ""}\n${result?.stderr || ""}`.trim();
  if (expectedVersion && !output.includes(expectedVersion)) {
    throw new Error(`RTK health check returned an unexpected version: ${output.slice(0, 200)}`);
  }
  return output;
}

async function installRtkRelease({
  root,
  release,
  platform = process.platform,
  arch = process.arch,
  dependencies = {},
}) {
  const assetName = rtkAssetName(platform, arch);
  if (!assetName) throw new Error(`RTK is unsupported on ${platform}/${arch}`);
  const assets = Array.isArray(release?.assets) ? release.assets : [];
  const asset = assets.find(item => item?.name === assetName);
  const checksums = assets.find(item => item?.name === "checksums.txt");
  if (!asset?.browser_download_url || !checksums?.browser_download_url) {
    throw new Error(`RTK release is missing ${assetName} or checksums.txt`);
  }
  const version = String(release.tag_name || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:[-.A-Za-z0-9]+)?$/.test(version)) throw new Error("Invalid RTK release version");
  const versionRoot = path.join(root, "components", "rtk", version);
  const finalBinary = path.join(versionRoot, platform === "win32" ? "rtk.exe" : "rtk");
  if (fs.statSync(finalBinary, { throwIfNoEntry: false })?.isFile()) {
    return { version, path: versionRoot, executable: finalBinary };
  }

  const temp = `${versionRoot}.staging-${process.pid}-${Date.now()}`;
  fs.rmSync(temp, { recursive: true, force: true });
  fs.mkdirSync(temp, { recursive: true, mode: 0o700 });
  try {
    const archive = path.join(temp, assetName);
    const fetchText = dependencies.downloadText || downloadText;
    const fetchFile = dependencies.downloadFile || downloadFile;
    await fetchFile(asset.browser_download_url, archive);
    const expected = checksumFor(await fetchText(checksums.browser_download_url), assetName);
    const actual = (dependencies.sha256 || fileSha256)(archive);
    if (expected !== actual) throw new Error("RTK SHA-256 verification failed");
    (dependencies.extractArchive || extractArchive)(archive, path.join(temp, "extracted"), platform);
    const binary = findRtkBinary(path.join(temp, "extracted"), platform);
    fs.mkdirSync(versionRoot, { recursive: true, mode: 0o700 });
    fs.copyFileSync(binary, finalBinary);
    if (platform !== "win32") fs.chmodSync(finalBinary, 0o755);
    (dependencies.verifyBinary || verifyRtkBinary)(finalBinary, version);
    return { version, path: versionRoot, executable: finalBinary };
  } catch (error) {
    fs.rmSync(versionRoot, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

module.exports = {
  checksumFor,
  fileSha256,
  installRtkRelease,
  rtkAssetName,
  verifyRtkBinary,
};
