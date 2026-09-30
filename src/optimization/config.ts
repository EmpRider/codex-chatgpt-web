import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { getConfigDir } from "../config";

export type OptimizationLevel = "off" | "lite" | "full" | "ultra";

export interface OptimizationSettings {
  autoUpdate: boolean;
  adhd: { enabled: boolean; activationMode: "always" | "on-demand" };
  rtk: { enabled: boolean; ultraCompact: boolean };
  headroom: {
    enabled: boolean;
    codeEnabled: boolean;
    mlEnabled: boolean;
    minTokens: number;
    protectRecentTurns: number;
    port: number;
  };
  caveman: { enabled: boolean; level: OptimizationLevel; autoClarity: boolean };
  ponytail: { enabled: boolean; level: OptimizationLevel; applyToSubagents: boolean };
  jev: {
    enabled: boolean;
    baseUrl: string;
    model: string;
    costWeight: number;
    adaptiveThinking: boolean;
    reassessAfterToolFailure: boolean;
    decisionTimeoutMs: number;
  };
}

export const DEFAULT_OPTIMIZATION_SETTINGS: OptimizationSettings = {
  autoUpdate: true,
  adhd: { enabled: true, activationMode: "always" },
  rtk: { enabled: true, ultraCompact: false },
  headroom: {
    enabled: true,
    codeEnabled: true,
    mlEnabled: false,
    minTokens: 500,
    protectRecentTurns: 2,
    port: 8787,
  },
  caveman: { enabled: true, level: "lite", autoClarity: true },
  ponytail: { enabled: true, level: "full", applyToSubagents: true },
  jev: {
    enabled: false,
    baseUrl: "https://api.typesafe.ai",
    model: "jev-latest",
    costWeight: 0.02,
    adaptiveThinking: true,
    reassessAfterToolFailure: true,
    decisionTimeoutMs: 4500,
  },
};

function object(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

function level(value: unknown, fallback: OptimizationLevel): OptimizationLevel {
  return value === "off" || value === "lite" || value === "full" || value === "ultra" ? value : fallback;
}

function modelName(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim();
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/.test(normalized) ? normalized : fallback;
}

function endpointUrl(value: unknown, fallback: string): string {
  if (typeof value !== "string" || !value.trim()) return fallback;
  try {
    const parsed = new URL(value.trim());
    if (parsed.username || parsed.password) return fallback;
    if (parsed.protocol === "https:") return parsed.toString().replace(/\/$/, "");
    const loopback = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);
    if (parsed.protocol === "http:" && loopback.has(parsed.hostname)) {
      return parsed.toString().replace(/\/$/, "");
    }
  } catch {}
  return fallback;
}

function int(value: unknown, fallback: number, min: number, max: number): number {
  return Number.isInteger(value) && Number(value) >= min && Number(value) <= max ? Number(value) : fallback;
}

function finite(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === "number" && Number.isFinite(value) && value >= min && value <= max ? value : fallback;
}

export function normalizeOptimizationSettings(value: unknown): OptimizationSettings {
  const root = object(value);
  const adhd = object(root.adhd);
  const rtk = object(root.rtk);
  const headroom = object(root.headroom);
  const caveman = object(root.caveman);
  const ponytail = object(root.ponytail);
  const jev = object(root.jev);
  return {
    autoUpdate: bool(root.autoUpdate, true),
    adhd: {
      enabled: bool(adhd.enabled, true),
      activationMode: adhd.activationMode === "on-demand" ? "on-demand" : "always",
    },
    rtk: {
      enabled: bool(rtk.enabled, true),
      ultraCompact: bool(rtk.ultraCompact, false),
    },
    headroom: {
      enabled: bool(headroom.enabled, true),
      codeEnabled: bool(headroom.codeEnabled, true),
      mlEnabled: bool(headroom.mlEnabled, false),
      minTokens: int(headroom.minTokens, 500, 50, 200_000),
      protectRecentTurns: int(headroom.protectRecentTurns, 2, 0, 20),
      port: int(headroom.port, 8787, 1024, 65535),
    },
    caveman: {
      enabled: bool(caveman.enabled, true),
      level: level(caveman.level, "lite"),
      autoClarity: bool(caveman.autoClarity, true),
    },
    ponytail: {
      enabled: bool(ponytail.enabled, true),
      level: level(ponytail.level, "full"),
      applyToSubagents: bool(ponytail.applyToSubagents, true),
    },
    jev: {
      enabled: bool(jev.enabled, false),
      baseUrl: endpointUrl(jev.baseUrl, "https://api.typesafe.ai"),
      model: modelName(jev.model, "jev-latest"),
      costWeight: finite(jev.costWeight, 0.02, 0, 1),
      adaptiveThinking: bool(jev.adaptiveThinking, true),
      reassessAfterToolFailure: bool(jev.reassessAfterToolFailure, true),
      decisionTimeoutMs: int(jev.decisionTimeoutMs, 4500, 500, 30_000),
    },
  };
}

export function optimizationRoot(): string {
  return join(getConfigDir(), "optimization");
}

export function optimizationRuntimeRoot(): string {
  return join(getConfigDir(), "optimization-runtime");
}

export function isManagedRuntimePath(candidate: string): boolean {
  if (!isAbsolute(candidate)) return false;
  const root = resolve(optimizationRuntimeRoot());
  const target = resolve(candidate);
  const rel = relative(root, target);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function loadOptimizationSettings(): OptimizationSettings {
  const path = join(optimizationRoot(), "settings.json");
  if (!existsSync(path)) return DEFAULT_OPTIMIZATION_SETTINGS;
  try {
    return normalizeOptimizationSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return DEFAULT_OPTIMIZATION_SETTINGS;
  }
}

export interface OptimizationRuntimeState {
  version: 1;
  headroom?: {
    running?: boolean;
    ready?: boolean;
    port?: number | null;
    preferredPort?: number | null;
    portConflict?: boolean;
  };
}

export function loadOptimizationRuntimeState(): OptimizationRuntimeState | undefined {
  const path = join(optimizationRoot(), "runtime.json");
  if (!existsSync(path)) return undefined;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as OptimizationRuntimeState;
    return value?.version === 1 ? value : undefined;
  } catch {
    return undefined;
  }
}

export function effectiveHeadroomPort(settings = loadOptimizationSettings()): number {
  const runtime = loadOptimizationRuntimeState()?.headroom;
  return runtime?.ready === true
    && Number.isInteger(runtime.port)
    && Number(runtime.port) >= 1024
    && Number(runtime.port) <= 65535
    ? Number(runtime.port)
    : settings.headroom.port;
}

export interface ManagedComponentRecord {
  version?: string;
  path?: string;
  executable?: string;
  status?: string;
  availableVersion?: string;
}

export function loadManagedComponent(id: string): ManagedComponentRecord | undefined {
  try {
    const versions = JSON.parse(readFileSync(join(optimizationRoot(), "versions.json"), "utf8")) as {
      components?: Record<string, ManagedComponentRecord>;
    };
    const record = versions.components?.[id];
    if (!record || typeof record !== "object") return undefined;
    if (record.status !== "ready") return undefined;
    if (record.path && !isManagedRuntimePath(record.path)) return undefined;
    if (record.executable && !isManagedRuntimePath(record.executable)) return undefined;
    return record;
  } catch {
    return undefined;
  }
}

export function loadManagedText(id: string, relativePath = "SKILL.md"): string | undefined {
  try {
    const record = loadManagedComponent(id);
    if (!record?.path || !existsSync(record.path)) return undefined;
    const file = join(record.path, relativePath);
    if (!existsSync(file)) return undefined;
    return readFileSync(file, "utf8").trim();
  } catch {
    return undefined;
  }
}
