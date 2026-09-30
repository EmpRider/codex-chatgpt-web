const fs = require("node:fs");
const { writePrivateFileAtomic } = require("../atomic-file.cjs");

function createOptimizationSecretStore({ filePath, safeStorage }) {
  function read() {
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8"));
      return parsed?.version === 1 && typeof parsed === "object" ? parsed : { version: 1 };
    } catch {
      return { version: 1 };
    }
  }

  function encryptionAvailable() {
    try { return safeStorage?.isEncryptionAvailable?.() === true; } catch { return false; }
  }

  function getJevApiKey() {
    const encoded = read().jevApiKey;
    if (typeof encoded !== "string" || !encoded) return null;
    if (!encryptionAvailable()) return null;
    try {
      const value = safeStorage.decryptString(Buffer.from(encoded, "base64")).trim();
      return value || null;
    } catch {
      return null;
    }
  }

  function hasJevApiKey() {
    return typeof read().jevApiKey === "string" && read().jevApiKey.length > 0;
  }

  function setJevApiKey(value) {
    const key = typeof value === "string" ? value.trim() : "";
    const current = read();
    if (!key) {
      delete current.jevApiKey;
      writePrivateFileAtomic(filePath, `${JSON.stringify(current, null, 2)}\n`);
      return false;
    }
    if (key.length > 4096) throw new Error("Jev API key is too long");
    if (!encryptionAvailable()) {
      throw new Error("Secure OS storage is unavailable; refusing to save the Jev API key");
    }
    const encrypted = safeStorage.encryptString(key).toString("base64");
    writePrivateFileAtomic(filePath, `${JSON.stringify({ ...current, version: 1, jevApiKey: encrypted }, null, 2)}\n`);
    return true;
  }

  return {
    encryptionAvailable,
    getJevApiKey,
    hasJevApiKey,
    setJevApiKey,
  };
}

module.exports = { createOptimizationSecretStore };
