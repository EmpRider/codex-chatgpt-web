const fs = require("node:fs");
const path = require("node:path");
const https = require("node:https");
const { spawnSync } = require("node:child_process");
const { writePrivateFileAtomic } = require("../atomic-file.cjs");
const { TOOL_MANIFEST, toolIds } = require("./manifest.cjs");
const { normalizeOptimizationSettings } = require("./settings.cjs");
const { resolveUpdatePlan, shouldCheckForUpdates } = require("./managed-tools.cjs");
const { decodeGitHubText, installTextSnapshot } = require("./provisioner.cjs");
const { installRtkRelease, verifyRtkBinary } = require("./rtk-manager.cjs");
const { HeadroomService, ensureHeadroom } = require("./headroom-manager.cjs");
const { provisionJev } = require("./jev-manager.cjs");
const { ensureOptimizationPaths, optimizationPaths } = require("./runtime-paths.cjs");

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

function pathInside(root, candidate) {
  if (typeof candidate !== "string" || !path.isAbsolute(candidate)) return false;
  const rel = path.relative(path.resolve(root), path.resolve(candidate));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

function localComponentHealthy(id, record, runtimeRoot) {
  if (!record?.version || !pathInside(runtimeRoot, record.path)) return false;
  try {
    if (TOOL_MANIFEST[id]?.kind === "skill") {
      const skill = typeof record.path === "string" ? path.join(record.path, "SKILL.md") : "";
      return Boolean(skill
        && fs.statSync(skill, { throwIfNoEntry: false })?.isFile()
        && fs.readFileSync(skill, "utf8").trim().length > 0);
    }
    if (id === "rtk") {
      if (typeof record.executable !== "string"
        || !pathInside(runtimeRoot, record.executable)
        || !fs.statSync(record.executable, { throwIfNoEntry: false })?.isFile()) return false;
      verifyRtkBinary(record.executable, record.version);
      return true;
    }
    if (id === "headroom") {
      if (typeof record.executable !== "string"
        || !pathInside(runtimeRoot, record.executable)
        || !fs.statSync(record.executable, { throwIfNoEntry: false })?.isFile()) return false;
      const result = spawnSync(record.executable, ["--version"], {
        encoding: "utf8", timeout: 15_000, windowsHide: true,
      });
      if (result.error || result.status !== 0) return false;
      return `${result.stdout || ""}\n${result.stderr || ""}`.includes(record.version);
    }
    if (id === "jev") {
      if (typeof record.path !== "string" || !pathInside(runtimeRoot, record.path)) return false;
      return fs.statSync(path.join(record.path, ".ready"), { throwIfNoEntry: false })?.isFile() === true
        && fs.statSync(path.join(record.path, "src", "router.mjs"), { throwIfNoEntry: false })?.isFile() === true
        && fs.statSync(path.join(record.path, "node_modules", "@typesafe-ai", "sdk"), { throwIfNoEntry: false })?.isDirectory() === true;
    }
    return false;
  } catch {
    return false;
  }
}

function headroomFlavorMatches(record, optimizationSettings) {
  return Boolean(record)
    && record.codeEnabled === optimizationSettings.headroom.codeEnabled
    && record.mlEnabled === optimizationSettings.headroom.mlEnabled;
}

function headroomRuntimeRecord(record) {
  if (!record?.version || !record?.path || !record?.executable) return null;
  return {
    version: record.version,
    path: record.path,
    executable: record.executable,
    ...(record.python ? { python: record.python } : {}),
    codeEnabled: record.codeEnabled,
    mlEnabled: record.mlEnabled,
  };
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

function createOptimizationController({ coreHome, stateStore, logger, secretStore, runtimeExecutable, publish }) {
  const paths = ensureOptimizationPaths(optimizationPaths(coreHome));
  const root = paths.runtimeRoot;
  const settingsPath = paths.settingsPath;
  const versionsPath = paths.versionsPath;
  let updatePromise = null;
  const headroomService = new HeadroomService({
    root,
    logger,
    onStateChange: () => {
      // Runtime health is ephemeral and intentionally not persisted into versions.json.
      // Publish a fresh snapshot so the GUI can distinguish installed from actually running.
      try { publish?.(snapshot()); } catch {}
    },
  });

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

  function notify() {
    const value = snapshot();
    publish?.(value);
    return value;
  }

  function snapshot() {
    const current = settings();
    const installed = versions();
    return {
      settings: current,
      root,
      lastUpdateCheckAt: stateStore.read().optimizationLastUpdateCheckAt ?? null,
      secrets: {
        jevApiKeyConfigured: secretStore?.hasJevApiKey?.() === true,
        encryptionAvailable: secretStore?.encryptionAvailable?.() === true,
      },
      components: toolIds().map(id => {
        const record = installedRecord(installed, id);
        const enabled = componentEnabled(current, id);
        const service = id === "headroom" ? headroomService.state() : null;
        let status = record?.status ?? (record?.version ? "ready" : "not-installed");
        let lastError = record?.lastError ?? null;
        if (id === "headroom" && enabled && record?.version && status === "ready") {
          status = service?.ready ? "running" : service?.running ? "starting" : service?.lastError ? "service-error" : "stopped";
          lastError = service?.lastError ?? lastError;
        }
        return {
          id,
          name: TOOL_MANIFEST[id].name,
          kind: TOOL_MANIFEST[id].kind,
          enabled,
          installedVersion: record?.version ?? null,
          availableVersion: record?.availableVersion ?? null,
          status,
          lastError,
        };
      }),
    };
  }

  async function setSettings(patch) {
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

    const headroomPackageChanged = next.headroom.enabled && (
      !current.headroom.enabled
      || current.headroom.codeEnabled !== next.headroom.codeEnabled
      || current.headroom.mlEnabled !== next.headroom.mlEnabled
    );
    const headroomServiceChanged = next.headroom.enabled && (
      headroomPackageChanged
      || current.headroom.port !== next.headroom.port
    );
    if (current.headroom.enabled && !next.headroom.enabled) {
      await headroomService.stop();
    } else if (headroomPackageChanged || headroomServiceChanged) {
      const installed = versions();
      const record = installedRecord(installed, "headroom");
      const version = record?.availableVersion || record?.version;
      if (version) {
        try {
          const result = headroomPackageChanged
            ? await provisionHeadroom(version, next)
            : {
                version: record.version,
                path: record.path,
                headroom: record.executable,
                python: record.python,
              };
          if (!result.headroom) throw new Error("Managed Headroom executable is unavailable");
          if (headroomPackageChanged) {
            installed.components.headroom = {
              ...record,
              version: result.version,
              availableVersion: result.version,
              path: result.path,
              executable: result.headroom,
              python: result.python,
              codeEnabled: next.headroom.codeEnabled,
              mlEnabled: next.headroom.mlEnabled,
              updateAction: "none",
              status: "ready",
              lastError: null,
              updatedAt: new Date().toISOString(),
            };
            writePrivateFileAtomic(versionsPath, `${JSON.stringify(installed, null, 2)}\n`);
          }
          await headroomService.start({
            executable: result.headroom,
            port: next.headroom.port,
            codeEnabled: next.headroom.codeEnabled,
            mlEnabled: next.headroom.mlEnabled,
          });
        } catch (error) {
          logger?.warn("optimization.headroom_reconfigure_failed", {
            message: error instanceof Error ? error.message : String(error),
          });
        }
      }
    }
    return { state, optimization: snapshot() };
  }

  async function githubFile(definition, sourcePath, ref) {
    const encodedPath = sourcePath.split("/").map(encodeURIComponent).join("/");
    return requestJson(
      `https://api.github.com/repos/${definition.repository}/contents/${encodedPath}?ref=${encodeURIComponent(ref)}`,
    );
  }

  async function provisionManagedJev(version) {
    const definition = TOOL_MANIFEST.jev;
    return provisionJev({
      root,
      version,
      runtimeExecutable,
      fetchFile: (sourcePath, ref) => githubFile(definition, sourcePath, ref),
    });
  }

  async function provisionHeadroom(version, currentSettings) {
    return ensureHeadroom({
      root,
      version,
      codeEnabled: currentSettings.headroom.codeEnabled,
      mlEnabled: currentSettings.headroom.mlEnabled,
    });
  }

  async function activateHeadroomWithRollback(installed, currentSettings, eventName) {
    const record = installedRecord(installed, "headroom");
    if (!record) return false;
    let failure = null;
    const currentHealthy = localComponentHealthy("headroom", record, paths.runtimeRoot)
      && headroomFlavorMatches(record, currentSettings);
    if (currentHealthy) {
      try {
        await headroomService.start({
          executable: record.executable,
          port: currentSettings.headroom.port,
          codeEnabled: currentSettings.headroom.codeEnabled,
          mlEnabled: currentSettings.headroom.mlEnabled,
        });
        return true;
      } catch (error) {
        failure = error;
      }
    } else {
      failure = new Error("Managed Headroom runtime is unavailable or has the wrong install flavor");
    }

    const previous = record.previous;
    const fallbackHealthy = previous
      && localComponentHealthy("headroom", previous, paths.runtimeRoot)
      && headroomFlavorMatches(previous, currentSettings);
    if (!fallbackHealthy) {
      logger?.warn(eventName, {
        message: failure instanceof Error ? failure.message : String(failure),
      });
      return false;
    }

    try {
      await headroomService.start({
        executable: previous.executable,
        port: currentSettings.headroom.port,
        codeEnabled: currentSettings.headroom.codeEnabled,
        mlEnabled: currentSettings.headroom.mlEnabled,
      });
      installed.components.headroom = {
        ...previous,
        availableVersion: record.availableVersion ?? record.version,
        updateAction: "update",
        status: "rollback-active",
        lastError: `Headroom ${record.version} failed to start; restored ${previous.version}: ${failure instanceof Error ? failure.message : String(failure)}`,
        previous: null,
        updatedAt: new Date().toISOString(),
      };
      writePrivateFileAtomic(versionsPath, `${JSON.stringify(installed, null, 2)}\n`);
      logger?.warn("optimization.headroom_rolled_back", {
        failedVersion: record.version,
        restoredVersion: previous.version,
      });
      return true;
    } catch (rollbackError) {
      logger?.warn(eventName, {
        message: `Headroom ${record.version} failed and rollback ${previous.version} also failed: ${rollbackError instanceof Error ? rollbackError.message : String(rollbackError)}`,
      });
      return false;
    }
  }

  async function ensureActive() {
    const currentSettings = settings();
    if (!currentSettings.headroom.enabled) {
      await headroomService.stop();
      return notify();
    }
    const installed = versions();
    await activateHeadroomWithRollback(installed, currentSettings, "optimization.headroom_start_failed");
    return notify();
  }

  async function provisionRtk(version) {
    const release = await requestJson("https://api.github.com/repos/rtk-ai/rtk/releases/latest");
    let licenseContent = null;
    try {
      licenseContent = decodeGitHubText(
        await githubFile(TOOL_MANIFEST.rtk, "LICENSE", `v${version}`),
        "LICENSE",
      );
    } catch (error) {
      logger?.warn("optimization.license_fetch_failed", {
        id: "rtk",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    const result = await installRtkRelease({ root, release, licenseContent });
    if (result.version !== version) {
      throw new Error(`RTK release changed during provisioning (${version} -> ${result.version})`);
    }
    return result;
  }

  async function provisionSkill(id, definition, version) {
    const sourceRef = definition.release
      ? `${definition.tagPrefix || ""}${version}`
      : version;
    const sourcePayload = await githubFile(definition, definition.sourcePath, sourceRef);
    const content = decodeGitHubText(sourcePayload, definition.sourcePath);
    let licenseContent = null;
    if (definition.licensePath) {
      try {
        licenseContent = decodeGitHubText(
          await githubFile(definition, definition.licensePath, sourceRef),
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

  async function performUpdateCheck({ force = false, startup = false } = {}) {
    const currentState = stateStore.read();
    const currentSettings = settings();
    const now = Date.now();
    if (!force && !currentSettings.autoUpdate) return snapshot();
    if (!force && !startup && !shouldCheckForUpdates(currentState.optimizationLastUpdateCheckAt, now)) {
      return snapshot();
    }

    const installed = versions();
    installed.components ||= {};
    await Promise.all(toolIds().map(async id => {
      const definition = TOOL_MANIFEST[id];
      const record = installedRecord(installed, id) || {};
      const healthyBeforeCheck = localComponentHealthy(id, record, paths.runtimeRoot)
        && (id !== "headroom" || headroomFlavorMatches(record, currentSettings));
      try {
        const availableVersion = await remoteVersion(definition);
        const plan = resolveUpdatePlan({
          id,
          installedVersion: healthyBeforeCheck ? record.version ?? null : null,
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
        } else if (id === "headroom" && (plan.action === "install" || plan.action === "update")) {
          const result = await provisionHeadroom(availableVersion, currentSettings);
          installed.components[id] = {
            ...record,
            version: result.version,
            path: result.path,
            executable: result.headroom,
            python: result.python,
            codeEnabled: currentSettings.headroom.codeEnabled,
            mlEnabled: currentSettings.headroom.mlEnabled,
            availableVersion,
            updateAction: "none",
            status: "ready",
            lastError: null,
            previous: healthyBeforeCheck && record.version !== result.version
              ? headroomRuntimeRecord(record)
              : record.previous ?? null,
            updatedAt: new Date().toISOString(),
          };
          logger?.info("optimization.component_updated", { id, version: result.version });
        } else if (id === "jev" && (plan.action === "install" || plan.action === "update")) {
          const result = await provisionManagedJev(availableVersion);
          installed.components[id] = {
            ...record,
            version: result.version,
            path: result.path,
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
          status: healthyBeforeCheck
            ? (record.version ? "ready" : "update-check-failed")
            : (record.version ? "repair-needed" : "update-check-failed"),
          lastError: message,
        };
        logger?.warn("optimization.update_check_failed", { id, message });
      }
    }));

    writePrivateFileAtomic(versionsPath, `${JSON.stringify(installed, null, 2)}\n`);
    stateStore.update({ optimizationLastUpdateCheckAt: new Date(now).toISOString() });
    if (currentSettings.headroom.enabled) {
      await activateHeadroomWithRollback(installed, currentSettings, "optimization.headroom_start_failed");
    } else {
      await headroomService.stop();
    }
    logger?.info("optimization.update_check_completed", { manual: force, startup });
    return notify();
  }

  async function checkUpdates(options = {}) {
    if (updatePromise) return updatePromise;
    const current = performUpdateCheck(options);
    updatePromise = current;
    try {
      return await current;
    } finally {
      if (updatePromise === current) updatePromise = null;
    }
  }

  function setJevApiKey(value) {
    if (!secretStore) throw new Error("Optimization secret store is unavailable");
    secretStore.setJevApiKey(value);
    return notify();
  }

  function jevApiKey() {
    return secretStore?.getJevApiKey?.() ?? null;
  }

  persistRuntimeSettings();

  return {
    checkUpdates,
    ensureActive,
    persistRuntimeSettings,
    root,
    setSettings,
    setJevApiKey,
    jevApiKey,
    snapshot,
    shutdown: () => headroomService.stop(),
  };
}

module.exports = {
  createOptimizationController,
  headroomFlavorMatches,
  headroomRuntimeRecord,
  localComponentHealthy,
  pathInside,
  mergeSettings,
  requestJson,
};
