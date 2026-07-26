import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { TIERS, type Tier, type TierModelRoutes } from "../types/dispatch.js";
import { isModelReference, parseModelCandidate } from "./model-candidate.js";

export const DTEAM_CONFIG_PATH = join(getAgentDir(), "pi-dteam.json");

export interface DteamConfigFile {
  tiers: Record<Tier, string[]>;
}

export interface DteamConfigStatus {
  path: string;
  exists: boolean;
  valid: boolean;
  routes: TierModelRoutes;
  missingTiers: Tier[];
  errors: string[];
}

export function loadDteamConfig(path = DTEAM_CONFIG_PATH): DteamConfigStatus {
  if (!existsSync(path)) {
    return { path, exists: false, valid: false, routes: {}, missingTiers: [...TIERS], errors: [`未找到配置文件 ${path}`] };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    return { path, exists: true, valid: false, routes: {}, missingTiers: [...TIERS], errors: [`配置文件不是有效 JSON：${errorMessage(error)}`] };
  }
  return parseDteamConfig(raw, path, true);
}

/** 校验完整候选链，并以原子 rename 持久化全局路由配置。 */
export function saveDteamConfig(tiers: DteamConfigFile["tiers"], path = DTEAM_CONFIG_PATH): DteamConfigStatus {
  const raw = { tiers };
  const checked = parseDteamConfig(raw, path, true);
  if (!checked.valid) throw new Error(formatDteamConfigWarning(checked));

  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = join(dirname(path), `.${path.split("/").at(-1)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporaryPath, `${JSON.stringify(raw, null, 2)}\n`, { mode: 0o600 });
    chmodSync(temporaryPath, 0o600);
    renameSync(temporaryPath, path);
    chmodSync(path, 0o600);
  } finally {
    rmSync(temporaryPath, { force: true });
  }
  return checked;
}

function parseDteamConfig(raw: unknown, path: string, exists: boolean): DteamConfigStatus {
  const errors: string[] = [];
  const routes: TierModelRoutes = {};
  const missingTiers: Tier[] = [];
  const tiers = isRecord(raw) && isRecord(raw.tiers) ? raw.tiers : undefined;

  if (!tiers) errors.push("缺少 tiers 配置对象");
  for (const tier of TIERS) {
    const candidates = parseTierCandidates(tiers?.[tier], tier, errors);
    if (!candidates?.length) {
      missingTiers.push(tier);
      if (!candidates) errors.push(`${tier} 必须是 provider/model[:thinking] 字符串数组`);
      continue;
    }
    routes[tier] = { primary: candidates[0], ...(candidates.length > 1 ? { fallbackModels: candidates.slice(1) } : {}) };
  }

  return { path, exists, valid: errors.length === 0 && missingTiers.length === 0, routes, missingTiers, errors };
}

export function formatDteamConfigWarning(status: DteamConfigStatus): string {
  if (status.valid) return "";
  const detail = status.errors.join("；");
  return `dteam 未启用：${detail}。T1/T2/T3 必须配置在 ${status.path}`;
}

function parseTierCandidates(value: unknown, tier: Tier, errors: string[]): string[] | undefined {
  const values = Array.isArray(value)
    ? value
    : isRecord(value) && typeof value.model === "string"
      ? [value.model, ...(parseLegacyFallbacks(value.fallbackModels, tier, errors) ?? [])]
      : undefined;
  if (!values || !values.every((item) => typeof item === "string")) return undefined;

  const models = [...new Set(values.map((item) => item.trim()).filter(Boolean))];
  for (const [index, candidate] of models.entries()) {
    if (!isModelReference(parseModelCandidate(candidate).modelStr)) {
      errors.push(`${Array.isArray(value) ? `${tier}[${index}]` : `${tier}.model`} 必须是 provider/model[:thinking] 格式：${candidate}`);
    }
  }
  return models;
}

function parseLegacyFallbacks(value: unknown, tier: Tier, errors: string[]): string[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${tier}.fallbackModels 必须是字符串数组`);
    return [];
  }
  return value.map((item) => item.trim()).filter(Boolean);
}


function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
