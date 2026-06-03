/**
 * dteam v1 — 编排器 (orchestrator)
 *
 * 主循环：
 *   1. 把 goal 写成 root task
 *   2. 循环 claimNext → dispatch
 *   3. dispatch = brancher.decide → decompose | leaf.execute
 *   4. 全部 done 后返回 RunResult
 */

import { TaskPool } from "./pool.js";
import { decide } from "./brancher.js";
import { execute } from "./leaf.js";
import type { Task, RunResult } from "./tools.js";
import { uiStore } from "./ui-store.js";

/**
 * 跑一个 goal。
 *
 * @param goal 用户目标
 * @param ctx Pi 扩展上下文（有 model, modelRegistry, cwd, ui）
 */
export async function run(goal: string, ctx: any): Promise<RunResult> {
  const pool = new TaskPool();

  // UI: 开始 run
  uiStore.startRun(goal);

  // 1. 写入 root task
  const rootId = `t-${Math.random().toString(36).slice(2, 14)}`;
  pool.write({
    id: rootId,
    parentId: null,
    title: goal,
    description: goal,
    status: "pending",
    createdAt: Date.now(),
  });
  // UI: 添加 root worker
  uiStore.addWorker({ id: rootId, parentId: null, title: goal });

  // 2. 主循环
  let safety = 0;
  const MAX_ITERATIONS = 50;

  while (safety++ < MAX_ITERATIONS) {
    const task = pool.claimNext();
    if (!task) break; // 没有 pending 任务了

    // claimNext 已经标记了 in_progress，不需要再 update
    uiStore.updateWorker(task.id, { status: "running" });

    try {
      // 3. 问 LLM：拆还是干
      const decision = await decide(task, ctx, goal);

      if (decision.kind === "decompose") {
        // 拆成子任务，写回池
        for (const sub of decision.subTasks) {
          const subId = `t-${Math.random().toString(36).slice(2, 14)}`;
          pool.write({
            id: subId,
            parentId: task.id,
            title: sub.title,
            description: sub.description,
            status: "pending",
            createdAt: Date.now(),
          });
          // UI: 添加子 worker
          uiStore.addWorker({ id: subId, parentId: task.id, title: sub.title });
        }
        pool.update(task.id, { status: "done", result: `decomposed into ${decision.subTasks.length} sub-tasks` });
        uiStore.updateWorker(task.id, { status: "done", recentOutput: `decomposed into ${decision.subTasks.length} sub-tasks` });
      } else {
        // 叶子执行
        const result = await execute(task, ctx, goal);
        pool.update(task.id, { status: "done", result });
        uiStore.updateWorker(task.id, { status: "done", recentOutput: result?.slice(0, 200) ?? "" });
      }
    } catch (e) {
      pool.update(task.id, { status: "failed", result: (e as Error).message });
      uiStore.updateWorker(task.id, { status: "failed", recentOutput: (e as Error).message });
    }
  }

  // 4. 汇总
  const items = pool.getAll();
  const done = items.filter((t) => t.status === "done").length;
  const failed = items.filter((t) => t.status === "failed").length;

  // UI: 结束 run
  uiStore.finishRun();

  return {
    status: failed > 0 ? "failed" : "done",
    workItems: items,
    summary: `${done}/${items.length} done, ${failed} failed`,
  };
}
