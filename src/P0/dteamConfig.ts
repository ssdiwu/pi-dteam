/**
 * P0-原子层：dteam 配置
 *
 * 三层配置加载（参考 dflow dconfig）：
 *   1. 内置默认
 *   2. 全域配置（~/.pi/agent/dteam/dconfig.json）
 *   3. 项目配置（<cwd>/.dteam/dconfig.json）
 */

import { readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

export interface DteamConfig {
  /** 角色→模型映射 */
  models: Record<string, string>;
  /** 角色→回退模型列表 */
  fallbackModels: Record<string, string[]>;
}

const DEFAULT_CONFIG: DteamConfig = {
  models: {},
  fallbackModels: {},
};

const GLOBAL_CONFIG_PATH = join(homedir(), ".pi", "agent", "dteam", "dconfig.json");

/**
 * 加载 dteam 配置。
 *
 * 优先级：内置默认 → 全域配置 → 项目配置
 */
export async function loadDteamConfig(cwd: string): Promise<DteamConfig> {
  let config: DteamConfig = structuredClone(DEFAULT_CONFIG);

  // 全域配置
  try {
    const raw = await readFile(GLOBAL_CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DteamConfig>;
    config = mergeConfig(config, parsed);
  } catch {
    // 文件不存在，静默跳过
  }

  // 项目配置
  try {
    const projectPath = join(cwd, ".dteam", "dconfig.json");
    const raw = await readFile(projectPath, "utf-8");
    const parsed = JSON.parse(raw) as Partial<DteamConfig>;
    config = mergeConfig(config, parsed);
  } catch {
    // 文件不存在，静默跳过
  }

  return config;
}

/**
 * 确保全域配置文件存在。
 */
export async function ensureDteamGlobalConfig(): Promise<void> {
  if (existsSync(GLOBAL_CONFIG_PATH)) return;

  try {
    const dir = dirname(GLOBAL_CONFIG_PATH);
    await mkdir(dir, { recursive: true });
    await writeFile(GLOBAL_CONFIG_PATH, JSON.stringify(DEFAULT_CONFIG, null, 2), "utf-8");
  } catch {
    // 创建失败，静默跳过
  }
}

function mergeConfig(base: DteamConfig, partial: Partial<DteamConfig>): DteamConfig {
  return {
    models: { ...base.models, ...partial.models },
    fallbackModels: { ...base.fallbackModels, ...partial.fallbackModels },
  };
}
