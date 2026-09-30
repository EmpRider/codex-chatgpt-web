const SIX_HOURS_MS = 6 * 60 * 60 * 1000;

function shouldCheckForUpdates(lastCheckedAt, now = Date.now()) {
  if (!lastCheckedAt) return true;
  const last = Date.parse(lastCheckedAt);
  if (!Number.isFinite(last)) return true;
  return now - last >= SIX_HOURS_MS;
}

function resolveUpdatePlan({ id, installedVersion, remoteVersion, remoteError }) {
  if (remoteError || !remoteVersion) {
    return installedVersion
      ? { id, action: "keep", version: installedVersion, reason: "update-check-failed" }
      : { id, action: "unavailable", version: null, reason: "update-check-failed" };
  }
  if (!installedVersion) return { id, action: "install", version: remoteVersion, reason: "missing" };
  if (installedVersion !== remoteVersion) {
    return { id, action: "update", version: remoteVersion, reason: "new-version" };
  }
  return { id, action: "none", version: installedVersion, reason: "current" };
}

module.exports = {
  SIX_HOURS_MS,
  resolveUpdatePlan,
  shouldCheckForUpdates,
};
