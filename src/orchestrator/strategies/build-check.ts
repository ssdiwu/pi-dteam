/**
 * dteam/orchestrator/strategies/build-check.ts — build_check 策略
 *
 * 【重构方案】Phase 4 - 4e 抽 strategies 子目录。
 *
 * ② 建检循环：build → check → 修 → 再 check，最多 N 轮。
 *   - 每轮用 leaf 跑 build，再用 leaf 跑 check
 *   - check 输出含"通过/pass/✓/✅/成功/没有问题/no issue/all tests pass" → 提前返回 done
 *   - 否则把 check 的反馈注入下一轮 build，循环
 *
 * 行为零变化：与重构前 in-line 实现的 runBuildCheck 完全相同。
 * O-6（正则改用结构化信号）暂留 Phase 5，本步骤不动正则。
 */

import { execute as runSolo } from "../../leaf.js";
import { DTEAM_CONFIG } from "../../config.js";
import type { PlanStep, StepResult } from "../../tools.js";
import type { DteamContext } from "../../types/context.js";

/**
 * ② 建检循环：build → check → 修 → 再 check，最多 {@link DTEAM_CONFIG.buildCheck.maxRounds} 轮。
 *
 * @param step   当前 step
 * @param ctx    外部 ctx
 * @param goal   全局目标
 * @param _dteam dteam 上下文（本策略未直接使用；保留以对齐 STRATEGIES 签名）
 */
export async function runBuildCheck(
  step: PlanStep,
  ctx: any,
  goal: string,
  _dteam?: DteamContext,
): Promise<StepResult> {
  const maxRounds = DTEAM_CONFIG.buildCheck.maxRounds;
  let currentTask = step.task;
  let lastOutput = "";
  let rounds = 0;

  for (let round = 0; round < maxRounds; round++) {
    rounds++;

    // Build
    const buildOutput = await runSolo("build", currentTask, ctx, goal);
    lastOutput = buildOutput;

    // Check
    const checkTask = `验证以下任务是否完成：${step.task}\n\n## build 输出\n${buildOutput}`;
    const checkOutput = await runSolo("check", checkTask, ctx, goal);

    // 通过？
    // O-6 暂留：v1 用正则判断（"通过|pass|✓|✅|成功|没有问题|no issue|all tests pass"）
    if (/通过|pass|✓|✅|成功|没有问题|no\s*issue|all\s*tests?\s*pass/i.test(checkOutput)) {
      return {
        role: step.role, task: step.task, strategy: "build_check",
        status: "done", output: buildOutput, rounds,
      };
    }

    // 不通过 → 注入问题到下一轮
    currentTask = `修复以下问题：\n${checkOutput}\n\n原任务：${step.task}`;
  }

  return {
    role: step.role, task: step.task, strategy: "build_check",
    status: "done", output: lastOutput, rounds,
  };
}
