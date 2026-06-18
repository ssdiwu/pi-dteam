/**
 * Multi-Provider Routing（多供应商路由）— 0.6.0 Phase 3
 *
 * 决策依据：ADR 0005 第 17 条（Multi-Provider Routing）。
 * 参考 ant-colony ModelOverrides + FallbackModels + resolveModelWithFallback。
 *
 * 每个角色可配置主模型 + fallback 链，避免单供应商约 3 并发就撞墙。
 * 主模型解析失败 → 依次尝试 fallback。
 */

import type { RoleName } from "../types/role.js";
import { resolveModelStr } from "../session/model-resolver.js";

/** per-role 主模型覆盖（"provider/id"） */
export type ModelOverrides = Partial<Record<RoleName, string>>;

/** per-role fallback 链（按顺序尝试） */
export type FallbackModels = Partial<Record<RoleName, string[]>>;

/**
 * 多供应商路由解析：给定角色 + modelRegistry + 默认模型，返回可用 Model 对象 + 实际使用的模型字符串。
 *
 * 候选链：role 覆盖的主模型 → role 的 fallback 链 → ctx 默认模型（provider/id）
 * 全部解析失败返回 { model: null, modelStr: null }（调用方应兜底报错）。
 *
 * @param role 角色
 * @param modelRegistry Pi modelRegistry
 * @param defaultModel 默认模型对象（ctx.model，含 provider/id）
 * @param overrides per-role 主模型覆盖
 * @param fallbacks per-role fallback 链
 */
export function resolveModelWithFallback(
  role: RoleName,
  modelRegistry: any,
  defaultModel?: { provider: string; id: string },
  overrides?: ModelOverrides,
  fallbacks?: FallbackModels,
): { model: any | null; modelStr: string | null } {
  const defaultStr = defaultModel ? `${defaultModel.provider}/${defaultModel.id}` : undefined;
  const primary = overrides?.[role] ?? defaultStr;
  const chain = fallbacks?.[role] ?? [];

  // 候选链：primary → fallbacks[]
  const candidates = [primary, ...chain].filter((m): m is string => typeof m === "string" && m.length > 0);

  for (const candidate of candidates) {
    try {
      const model = resolveModelStr(candidate, modelRegistry);
      return { model, modelStr: candidate };
    } catch {
      // 这个候选解析失败，试下一个
    }
  }

  return { model: null, modelStr: null };
}

/**
 * 判断错误是否为 429 rate limit（用于触发 fallback 或降并发）。
 */
export function isRateLimitError(e: unknown): boolean {
  const msg = e instanceof Error ? e.message : String(e);
  return /429|rate.?limit|too many requests/i.test(msg);
}
