/**
 * dteam v1 — 编排器 (orchestrator)
 *
 * 三阶段：Plan → Execute → Report
 * 二维：组织形式（solo/chain/team）× 执行策略（direct/build_check/adaptive）
 *
 * 【重构方案】Phase 4 全部完成：4a/4b/4c/4d/4e 子模块化 + 4f 走 reporter。
 * 行为零变化：reporter 默认实现委托 uiStore。
 */

import { plan } from "./planner.js";
import { TaskPool } from "./pool.js";
import { DTEAM_CONFIG } from "./config.js";
import { defaultReporter } from "./reporter.js";
import { installSignalHandlers } from "./orchestrator/signal-handlers.js";
import { buildHistoryContext } from "./orchestrator/history-context.js";
import { STRATEGIES } from "./orchestrator/strategies/index.js";
import type { Reporter } from "./reporter.js";
import type {
  ExecutionPlan, PlanStep, RunResult, StepResult, RoleName, Strategy, DteamContext,
} from "./tools.js";

const ROLE_ICONS: Record<RoleName, string> = {
  explore: "🔍", design: "📐", build: "⚒️", check: "🛡️", close: "📦",
};

// ═══ 主入口 ═══

export async function run(goal: string, ctx: any): Promise<RunResult> {
  const dteam = ctx.dteam as DteamContext | undefined;
  const taskPool = new TaskPool();
  const reporter: Reporter = ctx.reporter ?? defaultReporter;

  reporter.startRun(goal);

  // Phase 1: Plan
  let executionPlan: ExecutionPlan;
  try {
    executionPlan = await plan(goal, ctx);
  } catch (e) {
    executionPlan = {
      mode: "solo",
      reason: `规划失败: ${(e as Error).message}`,
      steps: [{ role: "build", task: goal, strategy: "direct" }],
    };
  }

  // Plan → TaskPool
  for (let i = 0; i < executionPlan.steps.length; i++) {
    const step = executionPlan.steps[i];
    taskPool.write({
      id: `task-${i}`, parentId: null, title: step.task,
      description: `${step.role} · ${step.strategy}`,
      status: "pending", createdAt: Date.now(),
    });
  }

  // UI: 显示规划结果
  reporter.addWorker({
    id: "plan", parentId: null,
    title: `📋 ${executionPlan.mode} · ${executionPlan.reason}`,
  });
  reporter.updateWorker("plan", { status: "running", recentOutput: executionPlan.reason ?? "" });
  reporter.updateWorker("plan", { status: "done" });

  // Phase 2: Execute
  const stepResults: StepResult[] = [];
  const helpSelfHealed = new Set<string>();
  const uninstallSignals = dteam
    ? installSignalHandlers(dteam, ctx, goal, helpSelfHealed, undefined as any, dteam.runsStore)
    : () => {};

  try {
    const order: "serial" | "parallel" = executionPlan.mode === "team" ? "parallel" : "serial";
    await executeSteps(executionPlan.steps, ctx, goal, stepResults, taskPool, dteam, order, reporter);
  } catch {
    // 致命错误，继续到 report
  } finally {
    uninstallSignals();
  }

  // Phase 3: Report
  reporter.finishRun();
  const done = stepResults.filter(s => s.status === "done").length;
  const failed = stepResults.filter(s => s.status === "failed").length;
  const signals = dteam ? dteam.signalBus.getHistory() : [];
  const workers = dteam ? dteam.runsStore.getAllWorkers(dteam.runId) : [];
  const taskSummary = taskPool.count();

  return {
    status: failed > 0 ? "failed" : "done",
    goal, plan: executionPlan, steps: stepResults,
    summary: failed > 0
      ? `${done}/${stepResults.length} 完成, ${failed} 失败`
      : `${done}/${stepResults.length} 完成`,
    signals, workers, taskSummary,
  };
}

// ═══ 执行调度 ═══

/**
 * serial = chain 模式（串行，前一步输出注入下一步）。
 * parallel = team 模式（分批并行，每批 ≤ DTEAM_CONFIG.team.batchSize）。
 */
async function executeSteps(
  steps: PlanStep[], ctx: any, goal: string, results: StepResult[],
  taskPool: TaskPool, dteam: DteamContext | undefined,
  order: "serial" | "parallel", reporter: Reporter,
): Promise<void> {
  if (order === "serial") {
    let prevOutput = "";
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      // 链式继承：上一步输出 + 前序 step 期间的 found/progress 信号
      const historyContext = dteam ? buildHistoryContext(dteam, i, step.role) : null;
      const taskWithPrev =
        `${step.task}` +
        (prevOutput ? `\n\n## 上一步输出\n${prevOutput}` : "") +
        (historyContext ? `\n\n${historyContext}` : "");
      const enhancedStep = { ...step, task: taskWithPrev };

      taskPool.claimNext();
      const result = await runStepWithStrategy(enhancedStep, ctx, goal, dteam, reporter);
      results.push(result);
      if (result.status === "done") {
        taskPool.complete(`task-${i}`, result.output);
      } else {
        taskPool.update(`task-${i}`, { status: "failed", result: result.output });
      }
      if (result.status === "failed") break;
      prevOutput = result.output;
    }
  } else {
    const batchSize = DTEAM_CONFIG.team.batchSize;
    for (let batchStart = 0; batchStart < steps.length; batchStart += batchSize) {
      const batch = steps.slice(batchStart, batchStart + batchSize);
      const batchResults = await Promise.all(
        batch.map((step, j) => {
          const idx = batchStart + j;
          taskPool.claimNext();
          return runStepWithStrategy(step, ctx, goal, dteam, reporter)
            .then(r => {
              if (r.status === "done") taskPool.complete(`task-${idx}`, r.output);
              else taskPool.update(`task-${idx}`, { status: "failed", result: r.output });
              return r;
            });
        }),
      );
      results.push(...batchResults);
    }
  }
}

// ═══ 策略执行 ═══

/** 按策略执行单个 step（4e 用 STRATEGIES 表调度，fallback 到 direct） */
async function runStepWithStrategy(
  step: PlanStep, ctx: any, goal: string,
  dteam: DteamContext | undefined, reporter: Reporter,
): Promise<StepResult> {
  const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const workerId = `w-${step.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const icon = ROLE_ICONS[step.role] ?? "●";
  reporter.addWorker({
    id: stepId, parentId: null,
    title: `${icon} ${step.role}: ${step.task}`,
  });
  reporter.updateWorker(stepId, { status: "running" });

  // 把 workerId 挂到 dteam context，让 leaf 用它发信号
  if (dteam) dteam.currentStepId = workerId;

  const fn = STRATEGIES[step.strategy as Strategy] ?? STRATEGIES.direct;
  let result = await fn(step, ctx, goal, dteam);

  // 检查 blocked 信号
  if (dteam && result.status === "done") {
    const blocked = dteam.signalBus.getHistory()
      .filter(s => s.type === "blocked" && s.runId === dteam.runId)
      .pop();
    if (blocked) {
      result = { ...result, status: "failed", output: `blocked: ${(blocked.data as any).message}\n${result.output}` };
    }
  }

  reporter.updateWorker(stepId, {
    status: result.status,
    recentOutput: result.output?.slice(0, 200) ?? "",
  });
  if (dteam) dteam.currentStepId = undefined;
  return result;
}

// ═══ 兼容导出（4c/4d：实现在子模块；tests/chain-forward.test.ts 仍 import 自此） ═══
export { forwardSignalToPeers } from "./orchestrator/peer-forwarder.js";
export { buildHistoryContext } from "./orchestrator/history-context.js";
