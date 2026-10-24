import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../../config";

export const NINE_ROUTER_KEY_ENV = "CODEX_CHATGPT_WEB_9ROUTER_API_KEY";

export function nineRouterKeyPath(configDir = getConfigDir()): string {
  return join(configDir, "integrations", "nine-router-key.json");
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{32,256}$/.test(value);
}

/** Disabled until an operator explicitly provisions a dedicated key outside the repository. */
export function loadNineRouterKey(configDir = getConfigDir(), environment = process.env[NINE_ROUTER_KEY_ENV]): string | undefined {
  if (environment !== undefined) {
    if (!validKey(environment)) throw new Error(`${NINE_ROUTER_KEY_ENV} must be an opaque 32+ character key`);
    return environment;
  }
  const path = nineRouterKeyPath(configDir);
  if (!existsSync(path)) return undefined;
  if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) {
    throw new Error("9Router key file has insecure permissions; require owner-only read/write");
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as { apiKey?: unknown; expiresAt?: unknown };
  if (!validKey(data.apiKey)) throw new Error("Saved 9Router integration key is invalid");
  if (data.expiresAt !== undefined && (typeof data.expiresAt !== "number"
    || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now())) {
    throw new Error("Saved 9Router integration key is expired or has invalid expiry");
  }
  return data.apiKey;
}

/** Key creation/rotation occurs on the operator's machine, not from public provider traffic. */
export function provisionNineRouterKey(operation: "create" | "rotate", configDir = getConfigDir()): string {
  const path = nineRouterKeyPath(configDir);
  if (operation === "create" && existsSync(path)) {
    throw new Error("A 9Router key already exists; explicitly use rotate to replace it");
  }
  const apiKey = randomBytes(36).toString("base64url");
  atomicWriteFile(path, `${JSON.stringify({ version: 1, apiKey })}\n`, { mode: 0o600 });
  return path;
}

export function disableNineRouterKey(configDir = getConfigDir()): string | undefined {
  const path = nineRouterKeyPath(configDir);
  if (!existsSync(path)) return undefined;
  const disabledPath = `${path}.disabled-${Date.now()}-${randomBytes(4).toString("hex")}`;
  renameSync(path, disabledPath);
  return disabledPath;
}
