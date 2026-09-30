const fs = require("node:fs");
const path = require("node:path");
const { writePrivateFileAtomic } = require("../atomic-file.cjs");

function safeSegment(value) {
  const text = String(value || "").trim();
  if (!/^[A-Za-z0-9._-]{1,128}$/.test(text)) throw new Error("Unsafe optimization version segment");
  return text;
}

function componentVersionRoot(root, id, version) {
  return path.join(root, "components", safeSegment(id), safeSegment(version));
}

function decodeGitHubText(payload, sourcePath) {
  if (!payload || payload.type !== "file" || payload.encoding !== "base64" || typeof payload.content !== "string") {
    throw new Error(`GitHub did not return a file for ${sourcePath}`);
  }
  const text = Buffer.from(payload.content.replace(/\s/g, ""), "base64").toString("utf8");
  if (!text.trim()) throw new Error(`Managed source is empty: ${sourcePath}`);
  return text;
}

function installTextSnapshot({ root, id, version, sourcePath, content, licenseContent = null }) {
  const versionRoot = componentVersionRoot(root, id, version);
  const temporary = `${versionRoot}.staging-${process.pid}-${Date.now()}`;
  fs.rmSync(temporary, { recursive: true, force: true });
  fs.mkdirSync(temporary, { recursive: true, mode: 0o700 });
  try {
    const target = path.join(temporary, "SKILL.md");
    writePrivateFileAtomic(target, content.endsWith("\n") ? content : `${content}\n`);
    if (licenseContent) {
      writePrivateFileAtomic(
        path.join(temporary, "LICENSE"),
        licenseContent.endsWith("\n") ? licenseContent : `${licenseContent}\n`,
      );
    }
    writePrivateFileAtomic(path.join(temporary, "source.json"), `${JSON.stringify({
      id,
      version,
      sourcePath,
      installedAt: new Date().toISOString(),
    }, null, 2)}\n`);
    fs.mkdirSync(path.dirname(versionRoot), { recursive: true, mode: 0o700 });
    const existingSkill = path.join(versionRoot, "SKILL.md");
    const existingValid = fs.statSync(existingSkill, { throwIfNoEntry: false })?.isFile()
      && fs.readFileSync(existingSkill, "utf8").trim().length > 0;
    if (existingValid) {
      fs.rmSync(temporary, { recursive: true, force: true });
    } else {
      fs.rmSync(versionRoot, { recursive: true, force: true });
      fs.renameSync(temporary, versionRoot);
    }
    return versionRoot;
  } catch (error) {
    fs.rmSync(temporary, { recursive: true, force: true });
    throw error;
  }
}

function updateVersionRecord(versionsPath, id, patch) {
  let state = { version: 1, components: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(versionsPath, "utf8"));
    if (parsed?.version === 1 && parsed.components && typeof parsed.components === "object") state = parsed;
  } catch {}
  state.components[id] = { ...(state.components[id] || {}), ...patch };
  writePrivateFileAtomic(versionsPath, `${JSON.stringify(state, null, 2)}\n`);
  return state.components[id];
}

module.exports = {
  componentVersionRoot,
  decodeGitHubText,
  installTextSnapshot,
  updateVersionRecord,
};
