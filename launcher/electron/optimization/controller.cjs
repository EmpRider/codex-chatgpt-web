const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { writePrivateFileAtomic } = require("../atomic-file.cjs");
const { TOOL_MANIFEST, toolIds } = require("./manifest.cjs");
const { normalizeOptimizationSettings } = require("./settings.cjs");
const { resolveUpdatePlan, shouldCheckForUpdates } = require("./managed-tools.cjs");
const { decodeGitHubText, installTextSnapshot } = require("./provisioner.cjs");
const { installRtkRelease } = require("./rtk-manager.cjs");

const USER_AGENT = "codex-web-gpt-optimization-manager";
const MAX_METADATA_BYTES = 2 * 1024 * 1024;

function readJson(filePath, fallback) {
  try {
    const value = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return value && typeof value === "object" ? value : fallback;
  } catch {
    return fallback;
  }
}

function requestJson(url, redirects = 0) {
  return new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("Too many optimization metadata redirects"));
    const parsed = new URL(url);
    if (parsed.protocol !== "https:") return reject(new Error("Optimization metadata requires HTTPS"));
    const request = https.get(parsed, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": USER_AGENT,
      },
    }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume();
        requestJson(new URL(response.headers.location, parsed).toString(), redirects + 1).then(resolve, reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`GitHub metadata request failed with HTTP ${response.statusCode}`));
        return;
      }
      const chunks = [];
      let bytes = 0;
      response.on("data", chunk => {
        bytes += chunk.length;
        if (bytes > MAX_METADATA_BYTES) {
          request.destroy(new Error("Optimization metadata exceeded size limit"));
          return;
        }
        chunks.push(chunk);
      });
      response.once("end", () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
        catch (error) { reject(error); }
      });
    });
    request.setTimeout(15_000, () => request.destroy(new Error("Optimization update check timed out")));
    request.once("error", reject);
  });
}

function componentEnabled(settings, id) {
  if (id === "i-have-adhd") return settings.adhd.enabled;
  return settings[id]?.enabled === true;
}

function installedRecord(versions, id) {
  const record = versions?.components?.[id];
  return record && typeof record === "object" ? record : null;
}

function mergeSettings(current, patch) {
  const next = { ...current, ...(patch && typeof patch === "object" ? patch : {}) };
  for (const key of ["adhd", "rtk", "headroom", "caveman", "ponytail", "jev"]) {
    if (patch?.[key] && typeof patch[key] === "object") {
      next[key] = { ...current[key], ...patch[key] };
    }
  }
  return normalizeOptimizationSettings(next);
}

function createOptimizationController({ coreHome, stateStore, logger }) {
  const root = path.join(coreHome, "optimization");
  const settingsPath = path.join(root, "settings.json");
  const versionsPath = path.join(root, "versions.json");
  fs.mkdirSync(root, { recursive: true, mode: 0o700 });

  function settings() {
    return normalizeOptimizationSettings(stateStore.read().optimization);
  }

  function versions() {
    const value = readJson(versionsPath, { version: 1, components: {} });
    if (value.version !== 1 || !value.components || typeof value.components !== "object") {
      return { version: 1, components: {} };
    }
    return value;
  }

  function persistRuntimeSettings(value = settings()) {
    writePrivateFileAtomic(settingsPath, `${JSON.stringify(value, null, 2)}\n`);
  }

  function snapshot() {
    const current = settings();
    const installed = versions();
    return {
      settings: current,
      root,
      lastUpdateCheckAt: stateStore.read().optimizationLastUpdateCheckAt ?? null,
      components: toolIds().map(id => {
        const record = installedRecord(installed, id);
        return {
          id,
          name: TOOL_MANIFEST[id].name,
          kind: TOOL_MANIFEST[id].kind,
          enabled: componentEnabled(current, id),
          installedVersion: record?.version ?? null,
          availableVersion: record?.availableVersion ?? null,
          status: record?.status ?? (record?.version ? "ready" : "not-installed"),
          lastError: record?.lastError ?? null,
        };
      }),
    };
  }

  function setSettings(patch) {
    const current = settings();
    const next = mergeSettings(current, patch);
    const state = stateStore.update({ optimization: next });
    persistRuntimeSettings(next);
    logger?.info("optimization.settings_changed", {
      autoUpdate: next.autoUpdate,
      enabled: {
        adhd: next.adhd.enabled,
        rtk: next.rtk.enabled,
        headroom: next.headroom.enabled,
        caveman: next.caveman.enabled,
        ponytail: next.ponytail.enabled,
        jev: next.jev.enabled,
      },
    });
    return { state, optimization: snapshot() };
  }

  async function githubFile(definition, sourcePath, ref) {
    const encodedPath = sourcePath.split("/").map(encodeURIComponent).join("/");
    return requestJson(
      `https://api.github.com/repos/${definition.repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    );
  }

  async function provisionRtk(version) {
    const release = await requestJson("https://api.github.com/repos/rtk-ai/rtk/releases/latest");
    const result = await installRtkRelease({ root, release });
    if (result.version !== version) {
      throw new Error(`RTK release changed during provisioning (${version} -> ${result.version})`);
    }
    return result;
  }

  async function provisionSkill(id, definition, version) {
    const sourcePayload = await githubFile(definition, definition.sourcePath, version);
    const content = decodeGitHubText(sourcePayload, definition.sourcePath);
    let licenseContent = null;
    if (definition.licensePath) {
      try {
        licenseContent = decodeGitHubText(
          await githubFile(definition, definition.licensePath, version),
          definition.licensePath,
        );
      } catch (error) {
        logger?.warn("optimization.license_fetch_failed", {
          id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
    const installedPath = installTextSnapshot({
      root,
      id,
      version,
      sourcePath: definition.sourcePath,
      content,
      licenseContent,
    });
    return installedPath;
  }

  async function remoteVersion(definition) {
    if (definition.release) {
      const release = await requestJson(`https://api.github.com/repos/${definition.repository}/releases/latest`);
      if (release?.draft === true || release?.prerelease === true || typeof release?.tag_name !== "string") {
        throw new Error("No stable release is available");
      }
      return release.tag_name.replace(/^v/, "");
    }
    const commit = await requestJson(
      `https://api.github.com/repos/${definition.repository}/commits/${encodeURIComponent(definition.branch || "main")}`,
    );
    if (typeof commit?.sha !== "string" || commit.sha.length < 12) throw new Error("GitHub returned no commit SHA");
    return commit.sha;
  }

  async function checkUpdates({ force = false } = {}) {
    const currentState = stateStore.read();
    const currentSettings = settings();
    const now = Date.now();
    if (!force && (!currentSettings.autoUpdate
      || !shouldCheckForUpdates(currentState.optimizationLastUpdateCheckAt, now))) {
      return snapshot();
    }

    const installed = versions();
    installed.components ||= {};
    await Promise.all(toolIds().map(async id => {
      const definition = TOOL_MANIFEST[id];
      const record = installedRecord(installed, id) || {};
      try {
        const availableVersion = await remoteVersion(definition);
        const plan = resolveUpdatePlan({
          id,
          installedVersion: record.version ?? null,
          remoteVersion: availableVersion,
          remoteError: null,
        });
        if (definition.kind === "skill" && (plan.action === "install" || plan.action === "update")) {
          const installedPath = await provisionSkill(id, definition, availableVersion);
          installed.components[id] = {
            ...record,
            version: availableVersion,
            path: installedPath,
            availableVersion,
            updateAction: "none",
            status: "ready",
            lastError: null,
            updatedAt: new Date().toISOString(),
          };
          logger?.info("optimization.component_updated", { id, version: availableVersion });
        } else if (id === "rtk" && (plan.action === "install" || plan.action === "update")) {
          const result = await provisionRtk(availableVersion);
          installed.components[id] = {
            ...record,
            version: result.version,
            path: result.path,
            executable: result.executable,
            availableVersion,
            updateAction: "none",
            status: "ready",
            lastError: null,
            updatedAt: new Date().toISOString(),
          };
          logger?.info("optimization.component_updated", { id, version: result.version });
        } else {
          installed.components[id] = {
            ...record,
            availableVersion,
            updateAction: plan.action,
            status: plan.action === "none" ? (record.version ? "ready" : "not-installed") : "update-available",
            lastError: null,
          };
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const plan = resolveUpdatePlan({
          id,
          installedVersion: record.version ?? null,
          remoteVersion: null,
          remoteError: error,
        });
        installed.components[id] = {
          ...record,
          updateAction: plan.action,
          status: record.version ? "ready" : "update-check-failed",
          lastError: message,
        };
        logger?.warn("optimization.update_check_failed", { id, message });
      }
    }));

    writePrivateFileAtomic(versionsPath, `${JSON.stringify(installed, null, 2)}\n`);
    stateStore.update({ optimizationLastUpdateCheckAt: new Date(now).toISOString() });
    logger?.info("optimization.update_check_completed", { manual: force });
    return snapshot();
  }

  persistRuntimeSettings();

  return {
    checkUpdates,
    persistRuntimeSettings,
    root,
    setSettings,
    snapshot,
  };
}

module.exports = {
  createOptimizationController,
  mergeSettings,
  requestJson,
};
