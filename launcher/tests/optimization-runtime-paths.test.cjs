const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const { optimizationPaths } = require("../electron/optimization/runtime-paths.cjs");
const { pathInside } = require("../electron/optimization/controller.cjs");

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

test("launcher runtime containment rejects paths outside the managed runtime", () => {
  const core = path.resolve("tmp-core-home");
  const runtime = path.join(core, "optimization-runtime");
  assert.equal(pathInside(runtime, path.join(runtime, "components", "rtk", "1")), true);
  assert.equal(pathInside(runtime, core), false);
  assert.equal(pathInside(runtime, path.resolve(core, "..", "outside")), false);
  assert.equal(pathInside(runtime, "relative/path"), false);
});

test("runtime path helper rejects sibling and traversal targets", () => {
  const core = path.resolve("tmp-core-home");
  const paths = optimizationPaths(core);
  assert.equal(path.normalize(paths.runtimeRoot), path.join(core, "optimization-runtime"));
  const sibling = path.join(core, "other-runtime", "rtk.exe");
  assert.notEqual(path.dirname(sibling), paths.runtimeRoot);
});
