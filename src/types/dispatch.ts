/**
 * dteam 0.7 — 单次 dispatch 的公共运行时契约。
 *
 * 这些类型刻意不表达 task plan、loop、signal 或角色流水线：
 * 主模型负责路由；dteam 只执行一次按档位派发。
 */

export const TIERS = ["T1", "T2", "T3"] as const;
export type Tier = (typeof TIERS)[number];

export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh"] as const;
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 一档模型的显式主模型与供应商回退链；不按名称或价格猜档。 */
export interface TierModelRoute {
  primary?: string;
  fallbackModels?: readonly string[];
}

export type TierModelRoutes = Partial<Record<Tier, TierModelRoute>>;

export interface DispatchRequest {
  /** fresh worker 必须能独立完成的任务描述。 */
  task: string;
  tier: Tier;
  /** 缺省时使用档位默认值。 */
  thinking?: ThinkingLevel;
  /** 缺省时使用档位默认白名单；提供时是最高权限上限。 */
  tools?: string[];
}

export interface DispatchAttempt {
  tier: Tier;
  model?: string;
  error?: string;
}

/** 一次派发的可追溯结果；同档候选尝试写入 attempts，跨档升级由主代理决定。 */
export interface DispatchResult {
  status: "done" | "failed";
  task: string;
  requestedTier: Tier;
  /** 实际完成任务的档位；同档候选自动尝试，跨档升级由主代理决定。 */
  tier: Tier;
  thinking: ThinkingLevel;
  tools: string[];
  result: string;
  model?: string;
  fellBack: boolean;
  attempts: DispatchAttempt[];
  error?: string;
  elapsedMs: number;
}
