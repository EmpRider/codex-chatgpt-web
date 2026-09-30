const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const assert = require("node:assert/strict");
const {
  activateStagedVersion,
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

test("managed Jev atomically replaces a corrupt existing version directory", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "jev-activate-"));
  try {
    const versionRoot = path.join(root, "components", "jev", "a".repeat(40));
    const staging = `${versionRoot}.staging-test`;
    fs.mkdirSync(versionRoot, { recursive: true });
    fs.writeFileSync(path.join(versionRoot, "partial.txt"), "corrupt");
    fs.mkdirSync(staging, { recursive: true });
    fs.writeFileSync(path.join(staging, ".ready"), "ok\n");
    fs.writeFileSync(path.join(staging, "router.txt"), "verified");

    activateStagedVersion(staging, versionRoot);

    assert.equal(fs.existsSync(staging), false);
    assert.equal(fs.existsSync(path.join(versionRoot, "partial.txt")), false);
    assert.equal(fs.readFileSync(path.join(versionRoot, "router.txt"), "utf8"), "verified");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
