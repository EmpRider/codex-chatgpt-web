const LEVELS = new Set(["off", "lite", "full", "ultra"]);
const ADHD_MODES = new Set(["always", "on-demand"]);

const DEFAULT_OPTIMIZATION_SETTINGS = Object.freeze({
  autoUpdate: true,
  adhd: Object.freeze({
    enabled: true,
    activationMode: "always",
  }),
  rtk: Object.freeze({
    enabled: true,
  }),
  headroom: Object.freeze({
    enabled: true,
    codeEnabled: true,
    mlEnabled: false,
    minTokens: 500,
    protectRecentTurns: 2,
    port: 8787,
  }),
  caveman: Object.freeze({
    enabled: true,
    level: "lite",
    autoClarity: true,
  }),
  ponytail: Object.freeze({
    enabled: true,
    level: "full",
    applyToSubagents: true,
  }),
  jev: Object.freeze({
    enabled: false,
    costWeight: 0.02,
    adaptiveThinking: true,
    reassessAfterToolFailure: true,
    decisionTimeoutMs: 4500,
  }),
});

function bool(value, fallback) {
  return typeof value === "boolean" ? value : fallback;
}
function numberIn(value, fallback, min, max) {
  return Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}
function integerIn(value, fallback, min, max) {
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback;
}
function level(value, fallback) {
  return LEVELS.has(value) ? value : fallback;
}

function normalizeOptimizationSettings(value) {
  const root = value && typeof value === "object" ? value : {};
  const adhd = root.adhd && typeof root.adhd === "object" ? root.adhd : {};
  const rtk = root.rtk && typeof root.rtk === "object" ? root.rtk : {};
  const headroom = root.headroom && typeof root.headroom === "object" ? root.headroom : {};
  const caveman = root.caveman && typeof root.caveman === "object" ? root.caveman : {};
  const ponytail = root.ponytail && typeof root.ponytail === "object" ? root.ponytail : {};
  const jev = root.jev && typeof root.jev === "object" ? root.jev : {};

  return {
    autoUpdate: bool(root.autoUpdate, DEFAULT_OPTIMIZATION_SETTINGS.autoUpdate),
    adhd: {
      enabled: bool(adhd.enabled, DEFAULT_OPTIMIZATION_SETTINGS.adhd.enabled),
      activationMode: ADHD_MODES.has(adhd.activationMode)
        ? adhd.activationMode : DEFAULT_OPTIMIZATION_SETTINGS.adhd.activationMode,
    },
    rtk: {
      enabled: bool(rtk.enabled, DEFAULT_OPTIMIZATION_SETTINGS.rtk.enabled),
    },
    headroom: {
      enabled: bool(headroom.enabled, DEFAULT_OPTIMIZATION_SETTINGS.headroom.enabled),
      codeEnabled: bool(headroom.codeEnabled, DEFAULT_OPTIMIZATION_SETTINGS.headroom.codeEnabled),
      mlEnabled: bool(headroom.mlEnabled, DEFAULT_OPTIMIZATION_SETTINGS.headroom.mlEnabled),
      minTokens: integerIn(headroom.minTokens, DEFAULT_OPTIMIZATION_SETTINGS.headroom.minTokens, 50, 200_000),
      protectRecentTurns: integerIn(
        headroom.protectRecentTurns,
        DEFAULT_OPTIMIZATION_SETTINGS.headroom.protectRecentTurns,
        0,
        20,
      ),
      port: integerIn(headroom.port, DEFAULT_OPTIMIZATION_SETTINGS.headroom.port, 1024, 65535),
    },
    caveman: {
      enabled: bool(caveman.enabled, DEFAULT_OPTIMIZATION_SETTINGS.caveman.enabled),
      level: level(caveman.level, DEFAULT_OPTIMIZATION_SETTINGS.caveman.level),
      autoClarity: bool(caveman.autoClarity, DEFAULT_OPTIMIZATION_SETTINGS.caveman.autoClarity),
    },
    ponytail: {
      enabled: bool(ponytail.enabled, DEFAULT_OPTIMIZATION_SETTINGS.ponytail.enabled),
      level: level(ponytail.level, DEFAULT_OPTIMIZATION_SETTINGS.ponytail.level),
      applyToSubagents: bool(
        ponytail.applyToSubagents,
        DEFAULT_OPTIMIZATION_SETTINGS.ponytail.applyToSubagents,
      ),
    },
    jev: {
      enabled: bool(jev.enabled, DEFAULT_OPTIMIZATION_SETTINGS.jev.enabled),
      costWeight: numberIn(jev.costWeight, DEFAULT_OPTIMIZATION_SETTINGS.jev.costWeight, 0, 1),
      adaptiveThinking: bool(jev.adaptiveThinking, DEFAULT_OPTIMIZATION_SETTINGS.jev.adaptiveThinking),
      reassessAfterToolFailure: bool(
        jev.reassessAfterToolFailure,
        DEFAULT_OPTIMIZATION_SETTINGS.jev.reassessAfterToolFailure,
      ),
      decisionTimeoutMs: integerIn(
        jev.decisionTimeoutMs,
        DEFAULT_OPTIMIZATION_SETTINGS.jev.decisionTimeoutMs,
        500,
        30_000,
      ),
    },
  };
}

module.exports = {
  DEFAULT_OPTIMIZATION_SETTINGS,
  normalizeOptimizationSettings,
};
