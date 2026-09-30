const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { writePrivateFileAtomic } = require("../atomic-file.cjs");
const { decodeGitHubText } = require("./provisioner.cjs");

const JEV_FILES = [
  "src/router.mjs",
  "src/effort.mjs",
  "src/config.mjs",
  "LICENSE",
  "NOTICE",
];

function validateCommit(value) {
  const sha = String(value || "").trim();
  if (!/^[a-f0-9]{40}$/i.test(sha)) throw new Error("Invalid Jev commit SHA");
  return sha.toLowerCase();
}

function runBun(runtimeExecutable, args, cwd, timeout = 120_000) {
  if (!runtimeExecutable) throw new Error("Managed Jev requires the launcher-owned Bun runtime");
  const result = spawnSync(runtimeExecutable, args, {
    cwd,
    encoding: "utf8",
    timeout,
    windowsHide: true,
    env: {
      ...process.env,
      BUN_INSTALL_CACHE_DIR: path.join(cwd, ".bun-cache"),
    },
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(`Managed Jev setup failed: ${String(result.stderr || result.stdout || "").trim()}`);
  }
  return result;
}

async function provisionJev({
  root,
  version,
  runtimeExecutable,
  fetchFile,
}) {
  const commit = validateCommit(version);
  if (typeof fetchFile !== "function") throw new Error("Managed Jev requires a GitHub file fetcher");
  const versionRoot = path.join(root, "components", "jev", commit);
  const marker = path.join(versionRoot, ".ready");
  if (fs.statSync(marker, { throwIfNoEntry: false })?.isFile()) {
    try {
      runBun(runtimeExecutable, [
        "-e",
        "import('./src/router.mjs').then(m=>{if(typeof m.Router!=='function')process.exit(2)})",
      ], versionRoot, 30_000);
      return { version: commit, path: versionRoot };
    } catch {
      fs.rmSync(versionRoot, { recursive: true, force: true });
    }
  }

  const staging = `${versionRoot}.staging-${process.pid}-${Date.now()}`;
  fs.rmSync(staging, { recursive: true, force: true });
  fs.mkdirSync(path.join(staging, "src"), { recursive: true, mode: 0o700 });
  try {
    const [upstreamPackage, upstreamLock] = await Promise.all([
      fetchFile("package.json", commit)
        .then(payload => JSON.parse(decodeGitHubText(payload, "package.json"))),
      fetchFile("package-lock.json", commit)
        .then(payload => JSON.parse(decodeGitHubText(payload, "package-lock.json"))),
    ]);
    const sdkRange = upstreamPackage?.dependencies?.["@typesafe-ai/sdk"];
    if (typeof sdkRange !== "string" || !sdkRange.trim()) {
      throw new Error("Jev upstream package does not declare @typesafe-ai/sdk");
    }
    const sdkVersion = upstreamLock?.packages?.["node_modules/@typesafe-ai/sdk"]?.version;
    if (typeof sdkVersion !== "string" || !/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(sdkVersion)) {
      throw new Error("Jev package-lock does not pin an exact @typesafe-ai/sdk version");
    }

    await Promise.all(JEV_FILES.map(async relative => {
      const content = decodeGitHubText(await fetchFile(relative, commit), relative);
      writePrivateFileAtomic(
        path.join(staging, relative),
        content.endsWith("\n") ? content : `${content}\n`,
      );
    }));

    writePrivateFileAtomic(path.join(staging, "package.json"), `${JSON.stringify({
      name: "codex-web-gpt-managed-jev",
      private: true,
      type: "module",
      dependencies: { "@typesafe-ai/sdk": sdkVersion },
    }, null, 2)}\n`);

    runBun(runtimeExecutable, ["install", "--production"], staging);
    runBun(runtimeExecutable, [
      "-e",
      "import('./src/router.mjs').then(m=>{if(typeof m.Router!=='function')process.exit(2)})",
    ], staging, 30_000);

    fs.rmSync(path.join(staging, ".bun-cache"), { recursive: true, force: true });
    writePrivateFileAtomic(path.join(staging, "source.json"), `${JSON.stringify({
      repository: "Loule95450/jev-free-router",
      commit,
      sdkVersion,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    writePrivateFileAtomic(path.join(staging, ".ready"), "ok\n");

    fs.mkdirSync(path.dirname(versionRoot), { recursive: true, mode: 0o700 });
    if (fs.existsSync(versionRoot)) fs.rmSync(staging, { recursive: true, force: true });
    else fs.renameSync(staging, versionRoot);
    return { version: commit, path: versionRoot };
  } catch (error) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw error;
  }
}

module.exports = {
  JEV_FILES,
  provisionJev,
  validateCommit,
};
