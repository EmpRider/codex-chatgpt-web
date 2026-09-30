import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getConfigDir } from "../config";

export type OptimizationLevel = "off" | "lite" | "full" | "ultra";

export interface OptimizationSettings {
  autoUpdate: boolean;
  adhd: { enabled: boolean; activationMode: "always" | "on-demand"; restoreAfterCompaction: boolean };
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
    costWeight: number;
    adaptiveThinking: boolean;
    reassessAfterToolFailure: boolean;
    decisionTimeoutMs: number;
  };
}

export const DEFAULT_OPTIMIZATION_SETTINGS: OptimizationSettings = {
  autoUpdate: true,
  adhd: { enabled: true, activationMode: "always", restoreAfterCompaction: true },
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
      restoreAfterCompaction: bool(adhd.restoreAfterCompaction, true),
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

export function loadOptimizationSettings(): OptimizationSettings {
  const path = join(optimizationRoot(), "settings.json");
  if (!existsSync(path)) return DEFAULT_OPTIMIZATION_SETTINGS;
  try {
    return normalizeOptimizationSettings(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    return DEFAULT_OPTIMIZATION_SETTINGS;
  }
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
    return record && typeof record === "object" ? record : undefined;
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
