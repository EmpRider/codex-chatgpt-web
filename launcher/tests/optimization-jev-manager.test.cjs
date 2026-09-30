const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateCommit,
  JEV_FILES,
  lockedTypeSafeSdkVersion,
} = require("../electron/optimization/jev-manager.cjs");

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

test("managed Jev requires an exact locked TypeSafe SDK version", () => {
  const pkg = { dependencies: { "@typesafe-ai/sdk": "^0.6.0" } };
  const lock = { packages: { "node_modules/@typesafe-ai/sdk": { version: "0.6.0" } } };
  assert.equal(lockedTypeSafeSdkVersion(pkg, lock), "0.6.0");
  assert.throws(() => lockedTypeSafeSdkVersion(pkg, { packages: {} }), /does not pin/);
  assert.throws(() => lockedTypeSafeSdkVersion({ dependencies: {} }, lock), /does not declare/);
});
