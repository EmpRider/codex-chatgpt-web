const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { createOptimizationSecretStore } = require("../electron/optimization/secrets.cjs");

test("Jev key is persisted only as encrypted bytes", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimizer-secret-"));
  const filePath = path.join(root, "secrets.json");
  const safeStorage = {
    isEncryptionAvailable: () => true,
    encryptString: value => Buffer.from(`enc:${value}`),
    decryptString: value => value.toString().replace(/^enc:/, ""),
  };
  try {
    const store = createOptimizationSecretStore({ filePath, safeStorage });
    store.setJevApiKey("secret-value");
    assert.equal(store.getJevApiKey(), "secret-value");
    assert.equal(store.hasJevApiKey(), true);
    assert.equal(fs.readFileSync(filePath, "utf8").includes("secret-value"), false);
    store.setJevApiKey("");
    assert.equal(store.hasJevApiKey(), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Jev key is not saved when OS encryption is unavailable", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "optimizer-secret-"));
  try {
    const store = createOptimizationSecretStore({
      filePath: path.join(root, "secrets.json"),
      safeStorage: { isEncryptionAvailable: () => false },
    });
    assert.throws(() => store.setJevApiKey("secret"), /Secure OS storage is unavailable/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
