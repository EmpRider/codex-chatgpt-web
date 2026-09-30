const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const {
  decodeGitHubText,
  installTextSnapshot,
  updateVersionRecord,
} = require("../electron/optimization/provisioner.cjs");

test("managed text snapshots install into versioned app-owned directories", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-optimizer-"));
  try {
    const installed = installTextSnapshot({
      root,
      id: "caveman",
      version: "abc123",
      sourcePath: "skills/caveman/SKILL.md",
      content: "# Caveman\nRules",
      licenseContent: "MIT",
    });
    assert.ok(installed.startsWith(root));
    assert.equal(fs.readFileSync(path.join(installed, "SKILL.md"), "utf8"), "# Caveman\nRules\n");
    assert.equal(fs.readFileSync(path.join(installed, "LICENSE"), "utf8"), "MIT\n");
    const record = updateVersionRecord(path.join(root, "versions.json"), "caveman", {
      version: "abc123", path: installed, status: "ready",
    });
    assert.equal(record.path, installed);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, "versions.json"), "utf8")).components.caveman.version, "abc123");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("GitHub text decoder accepts only base64 file payloads", () => {
  assert.equal(decodeGitHubText({
    type: "file", encoding: "base64", content: Buffer.from("hello").toString("base64"),
  }, "SKILL.md"), "hello");
  assert.throws(() => decodeGitHubText({ type: "dir" }, "SKILL.md"), /did not return a file/);
});

test("version path rejects path traversal", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "codex-web-optimizer-"));
  try {
    assert.throws(() => installTextSnapshot({
      root, id: "../evil", version: "1", sourcePath: "x", content: "x",
    }), /Unsafe optimization version segment/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
