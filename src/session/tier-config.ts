/**
 * dteam 0.7 — T1/T2/T3 档位默认值。
 *
 * T3 只读是安全默认：bash、edit、write 都要由调用方在 tools 显式授予。
 */

import { TIERS, type ThinkingLevel, type Tier, type TierModelRoutes } from "../types/dispatch.js";

export const READ_ONLY_TOOLS = ["read", "grep", "find", "ls"] as const;
export const WRITABLE_TOOLS = ["bash", "edit", "write"] as const;
export const DISPATCH_BUILT_IN_TOOLS = [...READ_ONLY_TOOLS, ...WRITABLE_TOOLS] as const;

export interface TierConfig {
  thinking: ThinkingLevel;
  tools: readonly string[];
  systemPrompt: string;
}

export const TIER_DEFAULTS: Record<Tier, TierConfig> = {
  T1: {
    thinking: "high",
    tools: DISPATCH_BUILT_IN_TOOLS,
    systemPrompt: "你是 dteam 的 T1 思考档 worker。完成自包含任务，严格只使用允许的工具，并给出可核验的结果。",
  },
  T2: {
    thinking: "medium",
    tools: DISPATCH_BUILT_IN_TOOLS,
    systemPrompt: "你是 dteam 的 T2 标准档 worker。完成自包含任务，严格只使用允许的工具，并简洁报告结果。",
  },
  T3: {
    thinking: "low",
    tools: READ_ONLY_TOOLS,
    systemPrompt: "你是 dteam 的 T3 快速档 worker。完成明确、机械的自包含任务，严格只使用允许的工具；除非调用方显式授权，否则不得写入或执行 shell。",
  },
};

/**
 * 预留给项目级明确配置的模型主链与供应商回退链。
 * 默认不猜测厂商型号：每档未配置 primary 时才回落 ctx.model。
 */
export const TIER_MODEL_ROUTES: TierModelRoutes = {
  T1: {},
  T2: {},
  T3: {},
};

/**
 * 从明确声明的环境变量装配档位模型路由。
 *
 * - DTEAM_T1_MODEL / DTEAM_T2_MODEL / DTEAM_T3_MODEL：`provider/id`
 * - DTEAM_T1_FALLBACK_MODELS 等：逗号分隔的 `provider/id` 链
 *
 * 不提供 primary 时保留空配置，由 dispatch 回落当前 ctx.model；不会按名称或价格猜档。
 */
export function tierModelRoutesFromEnv(env: Record<string, string | undefined> = process.env): TierModelRoutes {
  const routes: TierModelRoutes = {};
  for (const tier of TIERS) {
    const primary = env[`DTEAM_${tier}_MODEL`]?.trim();
    const fallbackModels = (env[`DTEAM_${tier}_FALLBACK_MODELS`] ?? "")
      .split(",")
      .map((model) => model.trim())
      .filter(Boolean);
    if (primary || fallbackModels.length > 0) {
      routes[tier] = {
        ...(primary ? { primary } : {}),
        ...(fallbackModels.length > 0 ? { fallbackModels } : {}),
      };
    }
  }
  return routes;
}

export function getTierTools(tier: Tier, requestedTools?: string[]): string[] {
  if (requestedTools === undefined) return [...TIER_DEFAULTS[tier].tools];

  const supported = new Set<string>(DISPATCH_BUILT_IN_TOOLS);
  return [...new Set(requestedTools.filter((tool) => supported.has(tool)))];
}

export function getTierThinking(tier: Tier, requestedThinking?: ThinkingLevel): ThinkingLevel {
  return requestedThinking ?? TIER_DEFAULTS[tier].thinking;
}

export function getTierPrompt(tier: Tier): string {
  return TIER_DEFAULTS[tier].systemPrompt;
}
