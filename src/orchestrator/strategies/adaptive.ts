/**
 * dteam/orchestrator/strategies/adaptive.ts — adaptive 策略
 *
 * 【重构方案】Phase 4 - 4e 抽 strategies 子目录。
 *
 * ③ 自适应：执行 → 评估 → 调整 → 再评估，最多 N 轮。
 *   - 每轮用 leaf 跑 step.role，再用 leaf 跑 check 评估
 *   - 评估输出含"满意/完成/达标/satisf/good enough" → 提前返回 done
 *   - 否则把评估的反馈注入下一轮，循环
 *
 * 行为零变化：与重构前 in-line 实现的 runAdaptive 完全相同。
 */

import { execute as runSolo } from "../../leaf.js";
import { DTEAM_CONFIG } from "../../config.js";
import type { PlanStep, StepResult } from "../../tools.js";
import type { DteamContext } from "../../types/context.js";

/**
 * ③ 自适应：执行 → 评估 → 调整 → 再评估，最多 {@link DTEAM_CONFIG.adaptive.maxRounds} 轮。
 *
 * @param step   当前 step
 * @param ctx    外部 ctx
 * @param goal   全局目标
 * @param _dteam dteam 上下文（本策略未直接使用；保留以对齐 STRATEGIES 签名）
 */
export async function runAdaptive(
  step: PlanStep,
  ctx: any,
  goal: string,
  _dteam?: DteamContext,
): Promise<StepResult> {
  const maxRounds = DTEAM_CONFIG.adaptive.maxRounds;
  let currentTask = step.task;
  let lastOutput = "";
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds++;

    // 执行
    const output = await runSolo(step.role as any, currentTask, ctx, goal, step.tools);
    lastOutput = output;

    // 评估
    const evalTask = `评估距离目标的差距：${step.task}\n\n## 当前输出\n${output}\n\n如果满意回复"满意"。否则给出具体改进建议。`;
    const evalOutput = await runSolo("check", evalTask, ctx, goal, step.tools);

    // 满意？
    if (/满意|完成|达标|satisf|good\s*enough/i.test(evalOutput)) {
      return {
        role: step.role, task: step.task, strategy: "adaptive",
        status: "done", output, rounds,
      };
    }

    // 不满意 → 注入反馈
    currentTask = `根据评估反馈改进：\n${evalOutput}\n\n原任务：${step.task}`;
  }

  return {
    role: step.role, task: step.task, strategy: "adaptive",
    status: "done", output: lastOutput, rounds,
  };
}
