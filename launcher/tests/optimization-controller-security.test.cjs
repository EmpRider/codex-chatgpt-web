const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  headroomFlavorMatches,
  headroomRuntimeRecord,
  newlyEnabledComponents,
  pathInside,
  shouldProvisionComponent,
} = require("../electron/optimization/controller.cjs");

test("launcher managed paths cannot escape optimization runtime", () => {
  const root = path.resolve("runtime-root");
  assert.equal(pathInside(root, path.join(root, "components", "rtk")), true);
  assert.equal(pathInside(root, root), true);
  assert.equal(pathInside(root, path.resolve(root, "..", "outside")), false);
  assert.equal(pathInside(root, "relative/path"), false);
});

test("Headroom health requires the installed extras to match GUI settings", () => {
  const settings = { headroom: { codeEnabled: true, mlEnabled: false } };
  assert.equal(headroomFlavorMatches({ codeEnabled: true, mlEnabled: false }, settings), true);
  assert.equal(headroomFlavorMatches({ codeEnabled: false, mlEnabled: false }, settings), false);
  assert.equal(headroomFlavorMatches({ codeEnabled: true, mlEnabled: true }, settings), false);
});

test("Headroom rollback record keeps only one last-known-good runtime", () => {
  const previous = headroomRuntimeRecord({
    version: "0.39.0",
    path: "/runtime/headroom/0.39.0",
    executable: "/runtime/headroom/0.39.0/headroom",
    python: "/runtime/headroom/0.39.0/python",
    codeEnabled: true,
    mlEnabled: false,
    previous: { version: "0.38.0" },
    lastError: "old",
  });
  assert.deepEqual(previous, {
    version: "0.39.0",
    path: "/runtime/headroom/0.39.0",
    executable: "/runtime/headroom/0.39.0/headroom",
    python: "/runtime/headroom/0.39.0/python",
    codeEnabled: true,
    mlEnabled: false,
  });
  assert.equal(headroomRuntimeRecord({ version: "0.39.0" }), null);
});

test("missing disabled components stay lazy while enabled or cached components provision", () => {
  const settings = {
    adhd: { enabled: true },
    ponytail: { enabled: false },
    caveman: { enabled: false },
    rtk: { enabled: false },
    headroom: { enabled: false },
    jev: { enabled: false },
  };
  assert.equal(shouldProvisionComponent(settings, "rtk", {}), false);
  assert.equal(shouldProvisionComponent(settings, "i-have-adhd", {}), true);
  assert.equal(shouldProvisionComponent(settings, "rtk", { version: "0.50.0" }), true);
});

test("OFF to ON transitions identify only components that need targeted reconciliation", () => {
  const current = {
    adhd: { enabled: true },
    ponytail: { enabled: false },
    caveman: { enabled: true },
    rtk: { enabled: false },
    headroom: { enabled: false },
    jev: { enabled: false },
  };
  const next = {
    adhd: { enabled: true },
    ponytail: { enabled: true },
    caveman: { enabled: true },
    rtk: { enabled: true },
    headroom: { enabled: false },
    jev: { enabled: false },
  };
  assert.deepEqual(newlyEnabledComponents(current, next), ["ponytail", "rtk"]);
});
