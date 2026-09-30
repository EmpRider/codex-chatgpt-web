const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DEFAULT_OPTIMIZATION_SETTINGS,
  normalizeOptimizationSettings,
} = require("../electron/optimization/settings.cjs");
const {
  TOOL_MANIFEST,
  toolIds,
} = require("../electron/optimization/manifest.cjs");
const {
  resolveUpdatePlan,
  shouldCheckForUpdates,
} = require("../electron/optimization/managed-tools.cjs");

test("plug-and-play defaults enable safe zero-setup optimizers", () => {
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.autoUpdate, true);
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.adhd.enabled, true);
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.rtk.enabled, true);
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.headroom.enabled, true);
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.headroom.codeEnabled, true);
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.headroom.mlEnabled, false);
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.caveman.level, "lite");
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.ponytail.level, "full");
  assert.equal(DEFAULT_OPTIMIZATION_SETTINGS.jev.enabled, false);
});

test("normalization repairs only invalid optimization fields", () => {
  const normalized = normalizeOptimizationSettings({
    autoUpdate: "yes",
    adhd: { enabled: false, activationMode: "wat" },
    rtk: { enabled: true, ultraCompact: true },
    headroom: { enabled: true, codeEnabled: false, mlEnabled: true, minTokens: -1, protectRecentTurns: 99 },
    caveman: { enabled: true, level: "ultra" },
    ponytail: { enabled: true, level: "full", applyToSubagents: false },
    jev: { enabled: true, costWeight: 2, adaptiveThinking: false, reassessAfterToolFailure: false, decisionTimeoutMs: 50 },
  });

  assert.equal(normalized.autoUpdate, true);
  assert.equal(normalized.adhd.enabled, false);
  assert.equal(normalized.adhd.activationMode, "always");
  assert.equal(normalized.rtk.ultraCompact, true);
  assert.equal(normalized.headroom.codeEnabled, false);
  assert.equal(normalized.headroom.mlEnabled, true);
  assert.equal(normalized.headroom.minTokens, 500);
  assert.equal(normalized.headroom.protectRecentTurns, 2);
  assert.equal(normalized.caveman.level, "ultra");
  assert.equal(normalized.ponytail.applyToSubagents, false);
  assert.equal(normalized.jev.enabled, true);
  assert.equal(normalized.jev.costWeight, 0.02);
  assert.equal(normalized.jev.decisionTimeoutMs, 4500);
});

test("manifest contains every managed optimization component", () => {
  assert.deepEqual(toolIds(), [
    "i-have-adhd",
    "ponytail",
    "caveman",
    "rtk",
    "headroom",
    "jev",
  ]);
  assert.equal(TOOL_MANIFEST["i-have-adhd"].kind, "skill");
  assert.equal(TOOL_MANIFEST.ponytail.kind, "skill");
  assert.equal(TOOL_MANIFEST.caveman.kind, "skill");
  assert.equal(TOOL_MANIFEST.rtk.kind, "binary");
  assert.equal(TOOL_MANIFEST.headroom.kind, "service");
  assert.equal(TOOL_MANIFEST.jev.kind, "module");
});

test("update plan preserves installed version when remote check fails", () => {
  const plan = resolveUpdatePlan({
    id: "rtk",
    installedVersion: "0.28.2",
    remoteVersion: null,
    remoteError: new Error("offline"),
  });
  assert.deepEqual(plan, {
    id: "rtk",
    action: "keep",
    version: "0.28.2",
    reason: "update-check-failed",
  });
});

test("update plan installs missing tools and upgrades changed versions", () => {
  assert.equal(resolveUpdatePlan({
    id: "rtk",
    installedVersion: null,
    remoteVersion: "0.29.0",
    remoteError: null,
  }).action, "install");
  assert.equal(resolveUpdatePlan({
    id: "rtk",
    installedVersion: "0.28.2",
    remoteVersion: "0.29.0",
    remoteError: null,
  }).action, "update");
  assert.equal(resolveUpdatePlan({
    id: "rtk",
    installedVersion: "0.29.0",
    remoteVersion: "0.29.0",
    remoteError: null,
  }).action, "none");
});

test("background update cadence remains bounded between explicit startup checks", () => {
  const now = Date.parse("2026-09-30T10:00:00Z");
  assert.equal(shouldCheckForUpdates(null, now), true);
  assert.equal(shouldCheckForUpdates("2026-09-30T05:00:01Z", now), false);
  assert.equal(shouldCheckForUpdates("2026-09-30T03:59:59Z", now), true);
});

test("managed policy sources prefer stable releases where upstream publishes them", () => {
  assert.equal(TOOL_MANIFEST.ponytail.release, true);
  assert.equal(TOOL_MANIFEST.ponytail.tagPrefix, "v");
  assert.equal(TOOL_MANIFEST.caveman.release, true);
  assert.equal(TOOL_MANIFEST.caveman.tagPrefix, "v");
  assert.equal(TOOL_MANIFEST["i-have-adhd"].release, undefined);
  assert.equal(TOOL_MANIFEST.jev.release, undefined);
});
