const test = require("node:test");
const assert = require("node:assert/strict");
const { validateCommit, JEV_FILES } = require("../electron/optimization/jev-manager.cjs");

test("managed Jev pins an exact upstream commit", () => {
  const sha = "a".repeat(40);
  assert.equal(validateCommit(sha.toUpperCase()), sha);
  assert.throws(() => validateCommit("main"), /Invalid Jev commit SHA/);
});

test("managed Jev includes the router contract and attribution files", () => {
  assert.ok(JEV_FILES.includes("src/router.mjs"));
  assert.ok(JEV_FILES.includes("src/effort.mjs"));
  assert.ok(JEV_FILES.includes("src/config.mjs"));
  assert.ok(JEV_FILES.includes("LICENSE"));
  assert.ok(JEV_FILES.includes("NOTICE"));
});
