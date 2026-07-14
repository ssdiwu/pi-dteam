import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { TIERS, type Tier, type TierModelRoutes } from "../types/dispatch.js";

export const DTEAM_CONFIG_PATH = join(homedir(), ".pi", "agent", "pi-dteam.json");

export interface DteamConfigFile {
  tiers: Record<Tier, { model: string; fallbackModels?: string[] }>;
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

  const errors: string[] = [];
  const routes: TierModelRoutes = {};
  const missingTiers: Tier[] = [];
  const tiers = isRecord(raw) && isRecord(raw.tiers) ? raw.tiers : undefined;

  if (!tiers) errors.push("缺少 tiers 配置对象");
  for (const tier of TIERS) {
    const entry = tiers?.[tier];
    const model = isRecord(entry) && typeof entry.model === "string" ? entry.model.trim() : "";
    if (!model) {
      missingTiers.push(tier);
      errors.push(`${tier} 缺少 model`);
      continue;
    }
    if (!isModelRef(model)) {
      errors.push(`${tier}.model 必须是 provider/id 格式：${model}`);
      continue;
    }
    const fallbackModels = isRecord(entry) && entry.fallbackModels !== undefined
      ? parseFallbacks(entry.fallbackModels, tier, errors)
      : undefined;
    routes[tier] = { primary: model, ...(fallbackModels?.length ? { fallbackModels } : {}) };
  }

  return { path, exists: true, valid: errors.length === 0 && missingTiers.length === 0, routes, missingTiers, errors };
}

export function formatDteamConfigWarning(status: DteamConfigStatus): string {
  if (status.valid) return "";
  const detail = status.errors.join("；");
  return `dteam 未启用：${detail}。T1/T2/T3 必须配置在 ${status.path}`;
}

function parseFallbacks(value: unknown, tier: Tier, errors: string[]): string[] | undefined {
  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${tier}.fallbackModels 必须是字符串数组`);
    return undefined;
  }
  const models = [...new Set(value.map((item) => item.trim()).filter(Boolean))];
  for (const model of models) if (!isModelRef(model)) errors.push(`${tier}.fallbackModels 包含无效模型：${model}`);
  return models;
}

function isModelRef(value: string): boolean {
  const slash = value.indexOf("/");
  return slash > 0 && slash < value.length - 1 && !value.includes(" ");
}

function isRecord(value: unknown): value is Record<string, any> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
