/**
 * dteam 0.7 — Multi-Provider Routing（多供应商路由）。
 *
 * 键可以是旧 runtime 尚未退场时的 role，也可以是 0.7 的 Tier；
 * 这里不判断模型名称、价格或能力，只消费调用方明确配置的主模型与回退链。
 */

import { resolveModelStr } from "../session/model-resolver.js";
import type { Tier, TierModelRoutes } from "../types/dispatch.js";

/** 指定键的主模型覆盖（`provider/id`）。 */
export type ModelOverrides<Key extends string = string> = Partial<Record<Key, string>>;
/** 指定键的供应商模型回退链。 */
export type FallbackModels<Key extends string = string> = Partial<Record<Key, readonly string[]>>;

export interface ResolvedModel {
  model: any | null;
  modelStr: string | null;
}

function defaultModelString(defaultModel?: { provider: string; id: string }): string | undefined {
  return defaultModel ? `${defaultModel.provider}/${defaultModel.id}` : undefined;
}

/**
 * 返回显式配置的候选链。primary 未配置时才把当前 ctx.model 放在首位；
 * 这避免在项目明确声明档位模型时静默改用主会话模型。
 */
export function modelCandidates<Key extends string>(
  key: Key,
  defaultModel?: { provider: string; id: string },
  overrides?: ModelOverrides<Key>,
  fallbacks?: FallbackModels<Key>,
): string[] {
  const primary = overrides?.[key];
  const initial = primary ?? defaultModelString(defaultModel);
  return [...new Set([initial, ...(fallbacks?.[key] ?? [])].filter((model): model is string => Boolean(model)))];
}

/** 解析第一个当前可用的候选模型；所有候选都不可用时返回 null。 */
export function resolveModelWithFallback<Key extends string>(
  key: Key,
  modelRegistry: any,
  defaultModel?: { provider: string; id: string },
  overrides?: ModelOverrides<Key>,
  fallbacks?: FallbackModels<Key>,
): ResolvedModel {
  for (const candidate of modelCandidates(key, defaultModel, overrides, fallbacks)) {
    try {
      return { model: resolveModelStr(candidate, modelRegistry), modelStr: candidate };
    } catch {
      // 当前候选不可用，继续明确的 fallback 链。
    }
  }
  return { model: null, modelStr: null };
}

/** 返回一个档位的显式模型候选链，供 dispatch 在运行时错误后逐个重试。 */
export function tierModelCandidates(
  tier: Tier,
  defaultModel?: { provider: string; id: string },
  routes: TierModelRoutes = {},
): string[] {
  const route = routes[tier];
  return modelCandidates(
    tier,
    defaultModel,
    route?.primary ? { [tier]: route.primary } : undefined,
    route?.fallbackModels ? { [tier]: route.fallbackModels } : undefined,
  );
}

/** 以档位配置转成通用路由输入，供只需首个可用模型的调用方使用。 */
export function resolveTierModelWithFallback(
  tier: Tier,
  modelRegistry: any,
  defaultModel?: { provider: string; id: string },
  routes: TierModelRoutes = {},
): ResolvedModel {
  const route = routes[tier];
  return resolveModelWithFallback(
    tier,
    modelRegistry,
    defaultModel,
    route?.primary ? { [tier]: route.primary } : undefined,
    route?.fallbackModels ? { [tier]: route.fallbackModels } : undefined,
  );
}

/** 判断错误是否为 429 rate limit（用于自适应并发与回退）。 */
export function isRateLimitError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /429|rate.?limit|too many requests/i.test(message);
}
