/**
 * dteam v1 — 编排器 (orchestrator)
 *
 * 唯一职责：驱动主循环。
 *
 * 对应工具表 C-1 / C-2。
 *
 * 主循环（v1）：
 *   1. 写根 task
 *   2. loop:
 *      a. claimNext() 拿一个 pending task
 *      b. 没有 → break
 *      c. 让 brancher.decide(task) 问 LLM 要拆还是干
 *      d. 拆 → 写子 task，当前 task 标 done
 *      e. 干 → 让 leaf.execute(task)，当前 task 标 done
 *   3. 返回 summary
 *
 * 同步阻塞模式：dteam 整个跑完才返回。
 */

import { decide } from "./brancher.js";
import { execute } from "./leaf.js";
import { TaskPool } from "./pool.js";
import type { RunResult, Task } from "./tools.js";

/**
 * v1 单步：处理一个 task。
 */
async function dispatch(
  task: Task,
  pool: TaskPool,
  model: any,
  goal: string,
): Promise<void> {
  // 1. 问 brancher：要拆还是干
  const decision = await decide(task, model, goal);

  if (decision.kind === "decompose") {
    // 2a. 拆：写子 task
    for (const sub of decision.subTasks) {
      pool.write({
        id: makeId(),
        parentId: task.id,
        title: sub.title,
        description: sub.description,
        status: "pending",
        createdAt: Date.now(),
      });
    }
    // 当前 task 标 done（"已分解"）
    pool.update(task.id, {
      status: "done",
      result: `[decomposed into ${decision.subTasks.length} sub-tasks] ${decision.reason}`,
    });
  } else {
    // 2b. 干：调 leaf
    const result = await execute(task, model, goal);
    pool.update(task.id, { status: "done", result });
  }
}

/**
 * v1 入口：跑完一个 goal 才返回。
 *
 * @param goal  用户目标
 * @param model 当前会话的 Model 对象
 */
export async function run(goal: string, model: any): Promise<RunResult> {
  const pool = new TaskPool();

  // 1. 写根 task
  pool.write({
    id: makeId(),
    parentId: null,
    title: goal,
    description: goal,
    status: "pending",
    createdAt: Date.now(),
  });

  // 2. 主循环
  while (true) {
    const task = pool.claimNext();
    if (!task) break;
    try {
      await dispatch(task, pool, model, goal);
    } catch (e) {
      // 任一 task 失败：标 failed，继续下一个（v1 简化：不停）
      pool.update(task.id, {
        status: "failed",
        result: `Error: ${(e as Error).message}`,
      });
    }
  }

  // 3. 收尾
  const tasks = pool.getAll();
  const c = pool.count();
  const summary = `${c.done}/${c.total} done${c.failed ? `, ${c.failed} failed` : ""}`;
  return {
    status: c.failed > 0 && c.done === 0 ? "failed" : "done",
    workItems: tasks,
    summary,
  };
}

/**
 * 生成 task id。
 * v1 简化：时间戳 + 短随机。
 */
function makeId(): string {
  return `t-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
}
