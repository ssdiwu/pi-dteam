/**
 * dteam v1 — 任务池 (pool)
 *
 * 设计原则：
 * - 内存池，v1 不持久化
 * - 无文件锁、无并发控制（v1 同步阻塞，不需要）
 * - 接口极简：write / claimNext / update / getAll
 *
 * 对应工具表 C-5：write / claimNext / update
 */

import type { Task, TaskStatus } from "./tools.js";

/**
 * 全局单例池。
 * v1 一个 goal = 一个 dteam 工具调用 = 一个池。
 * 如果并行多个 dteam 调用，v1 假设不发生（同步阻塞 + 串行）。
 */
class TaskPool {
  private tasks: Map<string, Task> = new Map();

  /**
   * 写入一个新任务。
   * 如果 id 已存在，抛错。
   */
  write(task: Task): void {
    if (this.tasks.has(task.id)) {
      throw new Error(`Pool: task ${task.id} already exists`);
    }
    this.tasks.set(task.id, task);
  }

  /**
   * 原子"选 + 占"下一个 pending 任务。
   * 找到第一个 pending 的，标记为 in_progress，返回。
   * 没有 pending 就返回 null。
   *
   * v1 简化：单线程同步跑，"原子"靠 JavaScript 单线程保证。
   */
  claimNext(): Task | null {
    for (const task of this.tasks.values()) {
      if (task.status === "pending") {
        task.status = "in_progress";
        return task;
      }
    }
    return null;
  }

  /**
   * 改任务状态和/或结果。
   * 任务不存在则忽略。
   */
  update(id: string, patch: { status?: TaskStatus; result?: string }): void {
    const task = this.tasks.get(id);
    if (!task) return;
    if (patch.status !== undefined) task.status = patch.status;
    if (patch.result !== undefined) task.result = patch.result;
  }

  /**
   * 拿所有任务（只读快照）。
   */
  getAll(): Task[] {
    return Array.from(this.tasks.values());
  }

  /**
   * 统计数量（用于 summary）。
   */
  count(): { total: number; done: number; failed: number } {
    const tasks = this.getAll();
    return {
      total: tasks.length,
      done: tasks.filter((t) => t.status === "done").length,
      failed: tasks.filter((t) => t.status === "failed").length,
    };
  }
}

export { TaskPool };
