const fs = require("node:fs");
const path = require("node:path");

function optimizationPaths(coreHome) {
  if (typeof coreHome !== "string" || !path.isAbsolute(coreHome)) {
    throw new Error("Optimization runtime requires an absolute application core home");
  }
  const controlRoot = path.join(coreHome, "optimization");
  const runtimeRoot = path.join(coreHome, "optimization-runtime");
  return {
    controlRoot,
    runtimeRoot,
    settingsPath: path.join(controlRoot, "settings.json"),
    versionsPath: path.join(controlRoot, "versions.json"),
    downloadsRoot: path.join(runtimeRoot, "downloads"),
    stagingRoot: path.join(runtimeRoot, "staging"),
    cacheRoot: path.join(runtimeRoot, "cache"),
    componentsRoot: path.join(runtimeRoot, "components"),
    runtimesRoot: path.join(runtimeRoot, "runtimes"),
  };
}

function ensureOptimizationPaths(paths) {
  for (const key of ["controlRoot", "runtimeRoot", "downloadsRoot", "stagingRoot", "cacheRoot", "componentsRoot", "runtimesRoot"]) {
    fs.mkdirSync(paths[key], { recursive: true, mode: 0o700 });
    if (process.platform !== "win32") {
      try { fs.chmodSync(paths[key], 0o700); } catch {}
    }
  }
  return paths;
}

module.exports = { ensureOptimizationPaths, optimizationPaths };
