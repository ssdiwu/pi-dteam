/**
 * dteam v1 — 编排器 (orchestrator)
 *
 * 三阶段：
 *   1. Plan  → 问 LLM 制定执行计划（二维：组织形式 × 执行策略）
 *   2. Execute → 按 plan 派 worker（solo/chain/team × direct/build_check/adaptive）
 *   3. Report → 汇总结果
 *
 * 递归分解：plan 阶段替代了旧 brancher 的顶层分解角色。
 * brancher 保留供后续在 build 步骤内部使用。
 */

import { plan } from "./planner.js";
import { execute as runSolo } from "./leaf.js";
import { uiStore } from "./ui/index.js";
import { TaskPool } from "./pool.js";
import type {
  ExecutionPlan, PlanStep, RunResult, StepResult, RoleName, Strategy,
  Signal, DteamContext,
} from "./tools.js";

const TEAM_BATCH_SIZE = 3;
const BUILD_CHECK_MAX_ROUNDS = 3;
const ADAPTIVE_MAX_ROUNDS = 5;

// ═══ 主入口 ═══

export async function run(goal: string, ctx: any): Promise<RunResult> {
  const dteam = ctx.dteam as DteamContext | undefined;
  const taskPool = new TaskPool();

  uiStore.startRun(goal);

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

  // Plan → TaskPool：把 steps 写成 task
  for (let i = 0; i < executionPlan.steps.length; i++) {
    const step = executionPlan.steps[i];
    taskPool.write({
      id: `task-${i}`,
      parentId: null,
      title: step.task,
      description: `${step.role} · ${step.strategy}`,
      status: "pending",
      createdAt: Date.now(),
    });
  }

  // UI: 显示规划结果
  uiStore.addWorker({
    id: "plan",
    parentId: null,
    title: `📋 ${executionPlan.mode} · ${executionPlan.reason}`,
  });
  uiStore.updateWorker("plan", { status: "done" });

  // Phase 2: Execute
  const stepResults: StepResult[] = [];

  try {
    switch (executionPlan.mode) {
      case "solo":
      case "chain":
        await executeSteps(executionPlan.steps, ctx, goal, stepResults, taskPool, dteam, "serial");
        break;
      case "team":
        await executeSteps(executionPlan.steps, ctx, goal, stepResults, taskPool, dteam, "parallel");
        break;
    }
  } catch {
    // 致命错误，继续到 report
  }

  // Phase 3: Report
  uiStore.finishRun();
  const done = stepResults.filter(s => s.status === "done").length;
  const failed = stepResults.filter(s => s.status === "failed").length;

  // 汇总信号
  const signals = dteam ? dteam.signalBus.getHistory() : [];
  const workers = dteam ? dteam.runsStore.getAllWorkers(dteam.runId) : [];
  const taskSummary = taskPool.count();

  return {
    status: failed > 0 ? "failed" : "done",
    goal,
    plan: executionPlan,
    steps: stepResults,
    summary: failed > 0
      ? `${done}/${stepResults.length} 完成, ${failed} 失败`
      : `${done}/${stepResults.length} 完成`,
    signals,
    workers,
    taskSummary,
  };
}

// ═══ 执行调度 ═══

/**
 * 执行一组 steps。
 * serial = chain 模式：串行，前一步输出注入下一步。
 * parallel = team 模式：分批并行，每批 ≤ TEAM_BATCH_SIZE。
 */
async function executeSteps(
  steps: PlanStep[],
  ctx: any,
  goal: string,
  results: StepResult[],
  taskPool: TaskPool,
  dteam: DteamContext | undefined,
  order: "serial" | "parallel",
): Promise<void> {
  if (order === "serial") {
    let prevOutput = "";

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const taskWithPrev = prevOutput
        ? `${step.task}\n\n## 上一步输出\n${prevOutput}`
        : step.task;
      const enhancedStep = { ...step, task: taskWithPrev };

      // claim task
      taskPool.claimNext();

      const result = await runStepWithStrategy(enhancedStep, ctx, goal, dteam);
      results.push(result);

      // 更新 task 状态
      if (result.status === "done") {
        taskPool.complete(`task-${i}`, result.output);
      } else {
        taskPool.update(`task-${i}`, { status: "failed", result: result.output });
      }

      // 检查信号：help → 自愈一次
      if (dteam && result.status === "done") {
        const helped = await handleHelpSignals(dteam, goal, ctx, prevOutput);
        if (helped) prevOutput = helped;
      }

      if (result.status === "failed") break;
      prevOutput = result.output;
    }
  } else {
    // parallel: 分批
    for (let batchStart = 0; batchStart < steps.length; batchStart += TEAM_BATCH_SIZE) {
      const batch = steps.slice(batchStart, batchStart + TEAM_BATCH_SIZE);
      const batchResults = await Promise.all(
        batch.map((step, j) => {
          const idx = batchStart + j;
          taskPool.claimNext();
          return runStepWithStrategy(step, ctx, goal, dteam)
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

/** 按策略执行单个 step */
async function runStepWithStrategy(
  step: PlanStep,
  ctx: any,
  goal: string,
  dteam: DteamContext | undefined,
): Promise<StepResult> {
  const stepId = `step-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  uiStore.addWorker({
    id: stepId,
    parentId: null,
    title: `${roleIcon(step.role)} ${step.role}: ${step.task.slice(0, 50)}`,
  });
  uiStore.updateWorker(stepId, { status: "running" });

  let result: StepResult;

  switch (step.strategy) {
    case "build_check":
      result = await runBuildCheck(step, ctx, goal, dteam);
      break;
    case "adaptive":
      result = await runAdaptive(step, ctx, goal, dteam);
      break;
    case "direct":
    default:
      result = await runDirect(step, ctx, goal);
      break;
  }

  // 检查 blocked 信号
  if (dteam && result.status === "done") {
    const blocked = dteam.signalBus.getHistory()
      .filter(s => s.type === "blocked" && s.runId === dteam.runId)
      .pop();
    if (blocked) {
      result = { ...result, status: "failed", output: `blocked: ${(blocked.data as any).message}\n${result.output}` };
    }
  }

  uiStore.updateWorker(stepId, {
    status: result.status,
    recentOutput: result.output?.slice(0, 200) ?? "",
  });

  return result;
}

/** ① 直接完成：跑一次 */
async function runDirect(
  step: PlanStep,
  ctx: any,
  goal: string,
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

/** ② 建检循环：build → check → 修 → 再 check，最多 3 轮 */
async function runBuildCheck(
  step: PlanStep,
  ctx: any,
  goal: string,
  _dteam?: DteamContext,
): Promise<StepResult> {
  let currentTask = step.task;
  let lastOutput = "";
  let rounds = 0;

  for (let round = 0; round < BUILD_CHECK_MAX_ROUNDS; round++) {
    rounds++;

    // Build
    const buildOutput = await runSolo("build", currentTask, ctx, goal);
    lastOutput = buildOutput;

    // Check
    const checkTask = `验证以下任务是否完成：${step.task}\n\n## build 输出\n${buildOutput}`;
    const checkOutput = await runSolo("check", checkTask, ctx, goal);

    // 通过？
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

/** ③ 自适应：执行 → 评估 → 调整 → 再评估，最多 5 轮 */
async function runAdaptive(
  step: PlanStep,
  ctx: any,
  goal: string,
  _dteam?: DteamContext,
): Promise<StepResult> {
  let currentTask = step.task;
  let lastOutput = "";
  let rounds = 0;

  for (let round = 0; round < ADAPTIVE_MAX_ROUNDS; round++) {
    rounds++;

    // 执行
    const output = await runSolo(step.role as any, currentTask, ctx, goal);
    lastOutput = output;

    // 评估
    const evalTask = `评估距离目标的差距：${step.task}\n\n## 当前输出\n${output}\n\n如果满意回复"满意"。否则给出具体改进建议。`;
    const evalOutput = await runSolo("check", evalTask, ctx, goal);

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

// ═══ 工具函数 ═══

// ═══ 信号自愈（help → 派 explore 补充一次） ═══

/**
 * 检查 help 信号，如果有就派 explore 补充一次信息。
 * 返回补充的输出，供下一步参考。没有 help 信号返回 null。
 */
async function handleHelpSignals(
  dteam: DteamContext,
  goal: string,
  ctx: any,
  prevOutput: string,
): Promise<string | null> {
  const helpSignals = dteam.signalBus.getHistory()
    .filter(s => s.type === "help" && s.runId === dteam.runId);
  if (helpSignals.length === 0) return null;

  const latest = helpSignals[helpSignals.length - 1];
  const data = latest.data as any;
  const supplementTask = [
    `## 主目标: ${goal}`,
    prevOutput ? `## 上一步输出\n${prevOutput}` : "",
    `## Worker 求助`,
    `- 缺什么: ${data.whatMissing ?? "未知"}`,
    `- 上下文: ${data.context ?? ""}`,
    `- 建议方向: ${data.suggestedDirection ?? "无"}`,
    ``,
    `请用 explore 角色搜索和收集缺失信息，补充给下一步。`,
  ].filter(Boolean).join("\n");

  try {
    const supplement = await runSolo("explore", supplementTask, ctx, goal);
    return `## 补充信息（来自 help 信号）\n${supplement}`;
  } catch {
    return null;
  }
}

// ═══ 工具函数 ═══

function roleIcon(role: RoleName): string {
  const icons: Record<RoleName, string> = {
    explore: "🔍",
    design: "📐",
    build: "⚒️",
    check: "🛡️",
    close: "📦",
  };
  return icons[role] ?? "●";
}
