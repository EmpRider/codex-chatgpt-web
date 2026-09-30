const crypto = require("node:crypto");
const fs = require("node:fs");
const https = require("node:https");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const USER_AGENT = "codex-web-gpt-headroom-manager";
const PYTHON_VERSION = "3.13";

function uvAssetName(platform = process.platform, arch = process.arch) {
  if (platform === "win32" && arch === "x64") return "uv-x86_64-pc-windows-msvc.zip";
  if (platform === "win32" && arch === "arm64") return "uv-aarch64-pc-windows-msvc.zip";
  if (platform === "darwin" && arch === "x64") return "uv-x86_64-apple-darwin.tar.gz";
  if (platform === "darwin" && arch === "arm64") return "uv-aarch64-apple-darwin.tar.gz";
  if (platform === "linux" && arch === "x64") return "uv-x86_64-unknown-linux-musl.tar.gz";
  if (platform === "linux" && arch === "arm64") return "uv-aarch64-unknown-linux-gnu.tar.gz";
  return null;
}

function headroomExtras({ codeEnabled, mlEnabled }) {
  return ["proxy", ...(codeEnabled ? ["code"] : []), ...(mlEnabled ? ["ml"] : [])];
}

function request(url, { acceptJson = false, redirects = 0 } = {}) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many Headroom dependency redirects"));
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return reject(new Error("Headroom dependency downloads require HTTPS"));
    const req = https.get(parsed, {
      headers: {
        "User-Agent": USER_AGENT,
        ...(acceptJson ? { Accept: "application/vnd.github+json" } : {}),
      },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        request(new URL(response.headers.location, parsed).toString(), { acceptJson, redirects: redirects + 1 })
          .then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Headroom dependency request failed with HTTP ${response.statusCode}`));
        return;
      }
      resolve(response);
    });
    req.setTimeout(60_000, () => req.destroy(new Error("Headroom dependency request timed out")));
    req.once("error", reject);
  });
}

async function json(url, maxBytes = 4 * 1024 * 1024) {
  const response = await request(url, { acceptJson: true });
  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    bytes += chunk.length;
    if (bytes > maxBytes) throw new Error("Headroom dependency metadata exceeded size limit");
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function download(url, destination) {
  const response = await request(url);
  await new Promise((resolve, reject) => {
    const output = fs.createWriteStream(destination, { flags: "wx", mode: 0o600 });
    response.pipe(output);
    output.once("finish", resolve);
    output.once("error", reject);
    response.once("error", reject);
  });
}

function sha256(filePath) {
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

function extract(archive, destination, platform = process.platform) {
  fs.mkdirSync(destination, { recursive: true, mode: 0o700 });
  let result = spawnSync("tar", ["-xf", archive, "-C", destination], {
    encoding: "utf8", timeout: 120_000, windowsHide: true,
  });
  if (result.status === 0) return;
  if (platform === "win32" && archive.endsWith(".zip")) {
    result = spawnSync("powershell.exe", [
      "-NoProfile", "-NonInteractive", "-Command",
      "Expand-Archive -LiteralPath $args[0] -DestinationPath $args[1] -Force",
      archive, destination,
    ], { encoding: "utf8", timeout: 120_000, windowsHide: true });
    if (result.status === 0) return;
  }
  throw new Error(`Could not extract Headroom dependency: ${String(result.stderr || result.error || "unknown error").trim()}`);
}

function findExecutable(root, names) {
  const wanted = new Set(names);
  const pending = [root];
  while (pending.length) {
    const current = pending.pop();
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const candidate = path.join(current, entry.name);
      if (entry.isDirectory()) pending.push(candidate);
      else if (entry.isFile() && wanted.has(entry.name)) return candidate;
    }
  }
  return null;
}

function run(executable, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    const append = (target, chunk) => {
      const next = target + chunk.toString();
      return next.length > 32_000 ? next.slice(-32_000) : next;
    };
    child.stdout.on("data", chunk => { stdout = append(stdout, chunk); });
    child.stderr.on("data", chunk => { stderr = append(stderr, chunk); });
    child.once("error", reject);
    child.once("exit", code => code === 0
      ? resolve({ stdout, stderr })
      : reject(new Error(`${path.basename(executable)} exited ${code}: ${stderr.trim() || stdout.trim()}`)));
  });
}

function verifyVersionCommand(executable, expectedVersion, runner = spawnSync) {
  const result = runner(executable, ["--version"], {
    encoding: "utf8",
    timeout: 15_000,
    windowsHide: true,
  });
  if (result?.error) throw result.error;
  if (result?.status !== 0) throw new Error(`${path.basename(executable)} health check failed`);
  const output = `${result?.stdout || ""}\n${result?.stderr || ""}`.trim();
  if (expectedVersion && !output.includes(expectedVersion)) {
    throw new Error(`${path.basename(executable)} returned unexpected version: ${output.slice(0, 200)}`);
  }
  return output;
}

async function ensureUv(root, { platform = process.platform, arch = process.arch, dependencies = {} } = {}) {
  const release = await (dependencies.json || json)("https://api.github.com/repos/astral-sh/uv/releases/latest");
  const version = String(release?.tag_name || "").replace(/^v/, "");
  if (!/^\d+\.\d+\.\d+(?:[-.A-Za-z0-9]+)?$/.test(version)) throw new Error("Invalid uv release version");
  const assetName = uvAssetName(platform, arch);
  if (!assetName) throw new Error(`Private Python runtime is unsupported on ${platform}/${arch}`);
  const asset = (release.assets || []).find(item => item?.name === assetName);
  if (!asset?.browser_download_url) throw new Error(`uv release is missing ${assetName}`);
  const expected = typeof asset.digest === "string" && asset.digest.startsWith("sha256:")
    ? asset.digest.slice("sha256:".length).toLowerCase()
    : null;
  if (!expected) throw new Error("uv release asset has no SHA-256 digest");

  const installRoot = path.join(root, "runtimes", "uv", version);
  const executableName = platform === "win32" ? "uv.exe" : "uv";
  const installed = path.join(installRoot, executableName);
  if (fs.statSync(installed, { throwIfNoEntry: false })?.isFile()) {
    try {
      (dependencies.verifyUv || verifyVersionCommand)(installed, version);
      return installed;
    } catch {
      fs.rmSync(installRoot, { recursive: true, force: true });
    }
  }

  const staging = `${installRoot}.staging-${process.pid}-${Date.now()}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(staging, { recursive: true, mode: 0o700 });
  try {
    const archive = path.join(staging, assetName);
    await (dependencies.download || download)(asset.browser_download_url, archive);
    const actual = (dependencies.sha256 || sha256)(archive);
    if (actual !== expected) throw new Error("uv SHA-256 verification failed");
    (dependencies.extract || extract)(archive, path.join(staging, "extracted"), platform);
    const found = findExecutable(path.join(staging, "extracted"), [executableName]);
    if (!found) throw new Error("uv archive did not contain the expected executable");
    fs.mkdirSync(installRoot, { recursive: true, mode: 0o700 });
    fs.copyFileSync(found, installed);
    if (platform !== "win32") fs.chmodSync(installed, 0o755);
    (dependencies.verifyUv || verifyVersionCommand)(installed, version);
    return installed;
  } catch (error) {
    fs.rmSync(installRoot, { recursive: true, force: true });
    throw error;
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

function venvExecutables(venvRoot, platform = process.platform) {
  const bin = path.join(venvRoot, platform === "win32" ? "Scripts" : "bin");
  return {
    python: path.join(bin, platform === "win32" ? "python.exe" : "python"),
    headroom: path.join(bin, platform === "win32" ? "headroom.exe" : "headroom"),
  };
}

async function ensureHeadroom({
  root,
  version,
  codeEnabled,
  mlEnabled,
  platform = process.platform,
  arch = process.arch,
  dependencies = {},
}) {
  if (!/^\d+\.\d+\.\d+(?:[-.A-Za-z0-9]+)?$/.test(String(version))) {
    throw new Error("Invalid Headroom version");
  }
  const flavor = ["proxy", codeEnabled ? "code" : null, mlEnabled ? "ml" : null].filter(Boolean).join("-");
  const installRoot = path.join(root, "components", "headroom", version, flavor);
  const venvRoot = path.join(installRoot, "venv");
  const executables = venvExecutables(venvRoot, platform);
  const runCommand = dependencies.run || run;
  if (fs.statSync(executables.headroom, { throwIfNoEntry: false })?.isFile()) {
    try {
      const health = await runCommand(executables.headroom, ["--version"], {
        env: {
          ...process.env,
          UV_PYTHON_INSTALL_DIR: path.join(root, "runtimes", "python"),
          UV_CACHE_DIR: path.join(root, "cache", "uv"),
        },
      });
      if (!`${health.stdout || ""}\n${health.stderr || ""}`.includes(version)) {
        throw new Error("Headroom runtime version does not match its managed version");
      }
      return { version, path: installRoot, ...executables };
    } catch {
      fs.rmSync(installRoot, { recursive: true, force: true });
    }
  }

  const uv = await ensureUv(root, { platform, arch, dependencies });
  fs.mkdirSync(installRoot, { recursive: true, mode: 0o700 });
  const env = {
    ...process.env,
    UV_PYTHON_INSTALL_DIR: path.join(root, "runtimes", "python"),
    UV_CACHE_DIR: path.join(root, "cache", "uv"),
  };
  try {
    await runCommand(uv, ["venv", "--python", PYTHON_VERSION, venvRoot], { env });
    const extras = headroomExtras({ codeEnabled, mlEnabled }).join(",");
    await runCommand(uv, [
      "pip", "install", "--python", executables.python,
      `headroom-ai[${extras}]==${version}`,
    ], { env });
    const health = await runCommand(executables.headroom, ["--version"], { env });
    if (!`${health.stdout || ""}\n${health.stderr || ""}`.includes(version)) {
      throw new Error("Headroom install returned an unexpected version");
    }
    return { version, path: installRoot, ...executables };
  } catch (error) {
    fs.rmSync(installRoot, { recursive: true, force: true });
    throw error;
  }
}

function localGetJson(port, route) {
  return new Promise((resolve, reject) => {
    const req = require("node:http").get({
      host: "127.0.0.1", port, path: route, timeout: 1000,
    }, response => {
      const chunks = [];
      response.on("data", chunk => chunks.push(chunk));
      response.once("end", () => {
        if (response.statusCode !== 200) return reject(new Error(`Headroom health HTTP ${response.statusCode}`));
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { reject(error); }
      });
    });
    req.once("timeout", () => req.destroy(new Error("Headroom health timed out")));
    req.once("error", reject);
  });
}

class HeadroomService {
  constructor({ root, logger }) {
    this.root = root;
    this.logger = logger;
    this.child = null;
    this.port = null;
  }

  async stop() {
    const child = this.child;
    this.child = null;
    this.port = null;
    if (!child || child.exitCode !== null) return;
    child.kill();
    await new Promise(resolve => {
      const timer = setTimeout(() => { try { child.kill("SIGKILL"); } catch {} resolve(); }, 3000);
      child.once("exit", () => { clearTimeout(timer); resolve(); });
    });
  }

  async start({ executable, port, codeEnabled, mlEnabled }) {
    await this.stop();
    const workspace = path.join(this.root, "headroom-workspace");
    fs.mkdirSync(workspace, { recursive: true, mode: 0o700 });
    const args = ["proxy", "--host", "127.0.0.1", "--port", String(port), codeEnabled ? "--code-aware" : "--no-code-aware"];
    const env = {
      ...process.env,
      HEADROOM_WORKSPACE_DIR: workspace,
      HEADROOM_TELEMETRY: "off",
      HEADROOM_LOG_LEVEL: "warning",
      ...(mlEnabled ? {} : { HEADROOM_DISABLE_KOMPRESS: "1" }),
    };
    const child = spawn(executable, args, {
      env, cwd: workspace, windowsHide: true, stdio: ["ignore", "ignore", "pipe"],
    });
    this.child = child;
    this.port = port;
    let stderr = "";
    child.stderr.on("data", chunk => {
      stderr = (stderr + chunk.toString()).slice(-8000);
    });
    child.once("exit", code => {
      if (this.child === child) {
        this.child = null;
        this.port = null;
        if (code !== 0) this.logger?.warn("optimization.headroom_exited", { code, detail: stderr.trim().slice(-1000) });
      }
    });
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (child.exitCode !== null) throw new Error(`Headroom exited during startup: ${stderr.trim()}`);
      try {
        const health = await localGetJson(port, "/readyz");
        if (health?.ready === true || health?.status === "healthy") {
          this.logger?.info("optimization.headroom_ready", { port });
          return health;
        }
      } catch {}
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    await this.stop();
    throw new Error("Headroom did not become ready");
  }
}

module.exports = {
  HeadroomService,
  ensureHeadroom,
  ensureUv,
  headroomExtras,
  uvAssetName,
  venvExecutables,
  verifyVersionCommand,
};
