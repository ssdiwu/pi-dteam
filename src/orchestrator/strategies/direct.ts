/**
 * dteam/orchestrator/strategies/direct.ts — direct 策略
 *
 * 【重构方案】Phase 4 - 4e 抽 strategies 子目录。
 *
 * ① 直接完成：跑一次 leaf.execute，结果即输出。
 *
 * 行为零变化：与重构前 in-line 实现的 runDirect 完全相同。
 */

import { execute as runSolo } from "../../leaf.js";
import type { PlanStep, StepResult } from "../../tools.js";
import type { DteamContext } from "../../types/context.js";

/**
 * ① 直接完成：跑一次。
 *
 * @param step  当前 step（role/task/strategy）
 * @param ctx   外部 ctx
 * @param goal  全局目标
 * @param _dteam dteam 上下文（direct 策略未使用；保留以对齐 STRATEGIES 签名）
 */
export async function runDirect(
  step: PlanStep,
  ctx: any,
  goal: string,
  _dteam?: DteamContext,
): Promise<StepResult> {
  try {
    const output = await runSolo(step.role, step.task, ctx, goal);
    return {
      role: step.role, task: step.task, strategy: step.strategy,
      status: "done", output,
    };
  } catch (e) {
    return {
      role: step.role, task: step.task, strategy: step.strategy,
      status: "failed", output: (e as Error).message,
    };
  }
}
