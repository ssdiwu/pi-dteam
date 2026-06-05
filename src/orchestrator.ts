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
import { installSignalHandlers } from "./orchestrator/signal-handlers.js";
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
  uiStore.updateWorker("plan", { status: "running", recentOutput: executionPlan.reason ?? "" });
  uiStore.updateWorker("plan", { status: "done" });

  // Phase 2: Execute
  const stepResults: StepResult[] = [];

  // 实时信号监听：progress/found/blocked/help → 更新 UI + 记录信号
  // 【重构方案】Phase 4 - 4a：4 路 listener 注册抽到 orchestrator/signal-handlers.ts
  const helpSelfHealed = new Set<string>();
  const uninstallSignals = dteam
    ? installSignalHandlers(dteam, ctx, goal, helpSelfHealed, uiStore, dteam.runsStore)
    : () => {};

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
  } finally {
    // 清理信号监听
    uninstallSignals();
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
      // 链式继承：派 step 前拼上：
      //  1. 上一步输出
      //  2. 前序 step 期间收集的 found/progress 信号
      const historyContext = dteam ? buildHistoryContext(dteam, i, step.role) : null;
      const taskWithPrev =
        `${step.task}` +
        (prevOutput ? `\n\n## 上一步输出\n${prevOutput}` : "") +
        (historyContext ? `\n\n${historyContext}` : "");
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
  const workerId = `w-${step.role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  uiStore.addWorker({
    id: stepId,
    parentId: null,
    title: `${roleIcon(step.role)} ${step.role}: ${step.task}`,
  });
  uiStore.updateWorker(stepId, { status: "running" });

  // 把 workerId 挂到 dteam context，让 leaf 用它发信号
  if (dteam) dteam.currentStepId = workerId;

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

  // 清除 currentStepId
  if (dteam) dteam.currentStepId = undefined;

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

// ═══ 实时转发：found/progress → 其他正在跑的叶子 ═══

/**
 * 将一个信号转发给同 run 下所有“正在跑”的其他叶子。
 * 注入方式：写入 dteam.injectionQueue[targetWorkerId] 的入队。
 * 【可观察】测试可验证：
 *   - injectionQueue 长度 + 1
 *   - uiStore.strategies 末尾出现 "转发 <type> from X → Y" 记录
 *   - 跳过发送者自身
 */
export function forwardSignalToPeers(
  dteam: DteamContext,
  sourceSignal: import("./tools.js").Signal,
  data: any,
): void {
  const summary = data.summary ?? data.action ?? "";
  if (!summary) return;
  const message = `[转发 ${sourceSignal.type} from ${sourceSignal.workerId}] ${summary}`;

  // 查找同 run 下所有 running worker（排除发送者）
  const workers = dteam.runsStore.getAllWorkers(dteam.runId);
  for (const w of workers) {
    if (w.id === sourceSignal.workerId) continue;
    if (w.status !== "running") continue;

    // 1. 写队列（叶子轮询/下次循环会拿到）
    const queue = dteam.injectionQueue.get(w.id) ?? [];
    queue.push(message);
    dteam.injectionQueue.set(w.id, queue);

    // 2. UI 记录
    uiStore.addStrategy({
      action: `转发 ${sourceSignal.type}`,
      target: `${sourceSignal.workerId} → ${w.id}`,
      detail: summary,
      timestamp: sourceSignal.timestamp,
    });
  }
}

// ═══ 链式继承：拼前序 step 的发现/进度 ═══

/**
 * 构建前序 step 的发现/进度摘要，注入到下一个 step 的 prompt。
 *
 * 采集规则：
 *  - found 信号 → 一律包含（信号本身就是“重要发现”的语义）
 *  - progress 信号 → 只保留 "完成"、"新建"、"修改"、"创建" 这类动作词
 *  - blocked/help 信号 → 不包含（这些是告警）
 *
 * 返回 null 表示没有可注入的内容。
 *
 * 【可观察测试点】返回的字符串里会带上 "[L<id> <type>]" 前缀，
 *  以及行末的 "(总计 X 条)"。这两个特征可作为测试断言。
 */
export function buildHistoryContext(
  dteam: DteamContext,
  currentStepIdx: number,
  currentStepRole: RoleName,
): string | null {
  const allSignals = dteam.signalBus.getHistory();
  // 拼上 prevOutput 的 index 一样靠"时间 < currentStep 起始"过滤
  // 这里简单：取所有未在 currentStep 期间产生的信号
  //（v1 简化：仅在 serial 模式调用，currentStepIdx 对应 steps 数组下标）

  const relevant = allSignals.filter((s) => {
    if (s.type !== "found" && s.type !== "progress") return false;
    // 过滤掉当前 step 期间的（仅在并行模式下存在；serial 模式不会）
    // 简化：仅看 type + summary
    return true;
  });

  if (relevant.length === 0) return null;

  // 过滤 progress 动作词
  const interesting = relevant.filter((s) => {
    if (s.type === "found") return true;
    if (s.type === "progress") {
      const data = s.data as any;
      const summary = data.summary ?? data.action ?? "";
      // 只保留“完成/新建/修改/创建”类动作词
      return /完成|新建|修改|创建|delete|create|modify|done/i.test(summary);
    }
    return false;
  });

  if (interesting.length === 0) return null;

  // 按 workerId + type 分组
  const lines: string[] = [];
  lines.push(`## 前序发现（链式 step ${currentStepIdx}，角色 ${currentStepRole}）`);
  for (const s of interesting) {
    const data = s.data as any;
    const summary = data.summary ?? data.action ?? "";
    lines.push(`- [${s.workerId} ${s.type}] ${summary}`);
  }
  lines.push(`(总计 ${interesting.length} 条)`);
  return lines.join("\n");
}

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
