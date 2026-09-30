const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { optimizationPaths } = require("../electron/optimization/runtime-paths.cjs");

test("optimization runtime dependencies are isolated from control settings", () => {
  const core = path.resolve("tmp-core-home");
  const paths = optimizationPaths(core);
  assert.equal(paths.controlRoot, path.join(core, "optimization"));
  assert.equal(paths.runtimeRoot, path.join(core, "optimization-runtime"));
  assert.equal(paths.settingsPath, path.join(core, "optimization", "settings.json"));
  assert.equal(paths.versionsPath, path.join(core, "optimization", "versions.json"));
  assert.equal(paths.componentsRoot, path.join(core, "optimization-runtime", "components"));
  assert.equal(paths.runtimesRoot, path.join(core, "optimization-runtime", "runtimes"));
});
