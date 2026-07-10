/**
 * dteam 0.7 — T1/T2/T3 档位默认值。
 *
 * T3 只读是安全默认：bash、edit、write 都要由调用方在 tools 显式授予。
 */

import type { ThinkingLevel, Tier, TierModelRoutes } from "../types/dispatch.js";

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
