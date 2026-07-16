/**
 * dteam 0.7 — T1/T2/T3 档位默认值。
 *
 * 所有档位均只读为安全默认：bash、edit、write 都要由调用方在 addTools 显式最小授予。
 */

import { TIERS, THINKING_LEVELS, type ThinkingLevel, type Tier, type TierModelRoutes } from "../types/dispatch.js";

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
    tools: READ_ONLY_TOOLS,
    systemPrompt: "你是 dteam 的 T1 思考档 worker。完成自包含任务，严格只使用允许的工具；完成前必须提交结构化工作报告，不要只停留在工具调用。"
  },
  T2: {
    thinking: "medium",
    tools: READ_ONLY_TOOLS,
    systemPrompt: "你是 dteam 的 T2 标准档 worker。完成自包含任务，严格只使用允许的工具；完成前必须提交结构化工作报告，不要只停留在工具调用。"
  },
  T3: {
    thinking: "low",
    tools: READ_ONLY_TOOLS,
    systemPrompt: "你是 dteam 的 T3 快速档 worker。完成明确、机械的自包含任务，严格只使用允许的工具；除非调用方显式授权，否则不得写入或执行 shell；完成前必须提交结构化工作报告，不要只停留在工具调用。"
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
 * 历史/测试用环境变量路由解析器。
 * 0.8 生产入口使用 `session/model-config.ts` 的 `~/.pi/agent/pi-dteam.json`，
 * 并要求 T1/T2/T3 三档都有 primary；不会在生产路径静默回落 ctx.model。
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

/** 从 provider/model[:thinking] 解析模型和思考强度；无后缀时跟随档位默认值。 */
export function parseTierModelCandidate(candidate: string, tier: Tier): { modelStr: string; thinkingLevel: ThinkingLevel } {
  const separator = candidate.lastIndexOf(":");
  const suffix = separator > candidate.indexOf("/") ? candidate.slice(separator + 1) : "";
  if (suffix && (THINKING_LEVELS as readonly string[]).includes(suffix)) {
    return { modelStr: candidate.slice(0, separator), thinkingLevel: suffix as ThinkingLevel };
  }
  return { modelStr: candidate, thinkingLevel: getTierThinking(tier) };
}

export function getTierPrompt(tier: Tier): string {
  return TIER_DEFAULTS[tier].systemPrompt;
}
