/**
 * dteam/orchestrator/strategies/index.ts — 策略表
 *
 * 【重构方案】Phase 4 - 4e 抽 strategies 子目录 + STRATEGIES 表。
 *
 * 用法（在 runStepWithStrategy 里）：
 *   const fn = STRATEGIES[step.strategy] ?? STRATEGIES.direct;
 *   const result = await fn(step, ctx, goal, dteam);
 *
 * 行为零变化：与重构前的 switch/case 等价。
 */

import type { PlanStep, StepResult, Strategy } from "../../tools.js";
import type { DteamContext } from "../../types/context.js";
import { runDirect } from "./direct.js";
import { runBuildCheck } from "./build-check.js";
import { runAdaptive } from "./adaptive.js";

/** 策略函数签名：所有策略函数都接收 (step, ctx, goal, dteam) 并返回 StepResult */
export type StrategyFn = (
  step: PlanStep,
  ctx: any,
  goal: string,
  dteam: DteamContext | undefined,
) => Promise<StepResult>;

/** 策略调度表：Strategy → 策略函数 */
export const STRATEGIES: Record<Strategy, StrategyFn> = {
  direct: runDirect,
  build_check: runBuildCheck,
  adaptive: runAdaptive,
};

export { runDirect, runBuildCheck, runAdaptive };
