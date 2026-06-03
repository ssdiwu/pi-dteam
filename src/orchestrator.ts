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

/**
 * 跑一个 goal。
 *
 * @param goal 用户目标
 * @param ctx Pi 扩展上下文（有 model, modelRegistry, cwd, ui）
 */
export async function run(goal: string, ctx: any): Promise<RunResult> {
  const pool = new TaskPool();

  // 1. 写入 root task
  pool.write({
    id: `t-${Math.random().toString(36).slice(2, 14)}`,
    parentId: null,
    title: goal,
    description: goal,
    status: "pending",
    createdAt: Date.now(),
  });

  // 2. 主循环
  let safety = 0;
  const MAX_ITERATIONS = 50;

  while (safety++ < MAX_ITERATIONS) {
    const task = pool.claimNext();
    if (!task) break; // 没有 pending 任务了

    // claimNext 已经标记了 in_progress，不需要再 update

    try {
      // 3. 问 LLM：拆还是干
      const decision = await decide(task, ctx, goal);

      if (decision.kind === "decompose") {
        // 拆成子任务，写回池
        for (const sub of decision.subTasks) {
          pool.write({
            id: `t-${Math.random().toString(36).slice(2, 14)}`,
            parentId: task.id,
            title: sub.title,
            description: sub.description,
            status: "pending",
            createdAt: Date.now(),
          });
        }
        pool.update(task.id, { status: "done", result: `decomposed into ${decision.subTasks.length} sub-tasks` });
      } else {
        // 叶子执行
        const result = await execute(task, ctx, goal);
        pool.update(task.id, { status: "done", result });
      }
    } catch (e) {
      pool.update(task.id, { status: "failed", result: (e as Error).message });
    }
  }

  // 4. 汇总
  const items = pool.getAll();
  const done = items.filter((t) => t.status === "done").length;
  const failed = items.filter((t) => t.status === "failed").length;

  return {
    status: failed > 0 ? "failed" : "done",
    workItems: items,
    summary: `${done}/${items.length} done, ${failed} failed`,
  };
}
