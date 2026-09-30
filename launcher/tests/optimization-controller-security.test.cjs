const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("node:path");
const {
  headroomFlavorMatches,
  pathInside,
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
