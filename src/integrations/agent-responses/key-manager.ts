import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { atomicWriteFile, getConfigDir } from "../../config";

export function agentResponsesKeyPath(configDir = getConfigDir()): string {
  return join(configDir, "integrations", "agent-responses-key.json");
}

function validKey(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{43,256}$/.test(value)
    && Buffer.from(value, "base64url").length >= 32;
}

/** No key means no generic provider. Never reuse native Codex credentials. */
export function loadAgentResponsesKey(configDir = getConfigDir()): string | undefined {
  const path = agentResponsesKeyPath(configDir);
  if (!existsSync(path)) return undefined;
  if (process.platform !== "win32" && (statSync(path).mode & 0o077) !== 0) {
    throw new Error("Generic Responses key file requires owner-only permissions");
  }
  const data = JSON.parse(readFileSync(path, "utf8")) as { apiKey?: unknown; expiresAt?: unknown };
  if (!validKey(data.apiKey)) throw new Error("Generic Responses key is invalid");
  if (data.expiresAt !== undefined && (typeof data.expiresAt !== "number"
    || !Number.isFinite(data.expiresAt) || data.expiresAt <= Date.now())) {
    throw new Error("Generic Responses key has invalid or expired expiry");
  }
  return data.apiKey;
}

/** Key lifecycle is operator-only; network requests cannot create or rotate it. */
export function provisionAgentResponsesKey(operation: "create" | "rotate", configDir = getConfigDir()): string {
  const path = agentResponsesKeyPath(configDir);
  if (operation === "create" && existsSync(path)) {
    throw new Error("Generic Responses key already exists; explicit rotate required");
  }
  atomicWriteFile(path, `${JSON.stringify({ version: 1, apiKey: randomBytes(36).toString("base64url") })}\n`,
    { mode: 0o600, durable: true });
  return path;
}

export function disableAgentResponsesKey(configDir = getConfigDir()): string | undefined {
  const path = agentResponsesKeyPath(configDir);
  if (!existsSync(path)) return undefined;
  const disabled = `${path}.disabled-${Date.now()}-${randomBytes(4).toString("hex")}`;
  renameSync(path, disabled);
  return disabled;
}
