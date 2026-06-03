/**
 * pool.ts 单元测试
 *
 * 覆盖：write / claimNext / update / getAll / count
 * 纯内存逻辑，不需要 LLM。
 */

import { describe, it, expect } from "vitest";
import { TaskPool } from "../src/pool.js";
import type { Task } from "../src/tools.js";

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: `t-${Math.random().toString(36).slice(2, 8)}`,
    parentId: null,
    title: "test task",
    description: "test description",
    status: "pending",
    createdAt: Date.now(),
    ...overrides,
  };
}

describe("TaskPool", () => {
  describe("write", () => {
    it("写入一个任务", () => {
      const pool = new TaskPool();
      const task = makeTask({ id: "t-1" });
      pool.write(task);
      expect(pool.getAll()).toHaveLength(1);
      expect(pool.getAll()[0].id).toBe("t-1");
    });

    it("重复 id 抛错", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      expect(() => pool.write(makeTask({ id: "t-1" }))).toThrow("already exists");
    });

    it("写入多个任务", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      pool.write(makeTask({ id: "t-2" }));
      pool.write(makeTask({ id: "t-3" }));
      expect(pool.getAll()).toHaveLength(3);
    });
  });

  describe("claimNext", () => {
    it("池空时返回 null", () => {
      const pool = new TaskPool();
      expect(pool.claimNext()).toBeNull();
    });

    it("返回第一个 pending 任务并标记为 in_progress", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "pending" }));
      const claimed = pool.claimNext();
      expect(claimed).not.toBeNull();
      expect(claimed!.id).toBe("t-1");
      expect(claimed!.status).toBe("in_progress");
    });

    it("跳过非 pending 任务", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "done" }));
      pool.write(makeTask({ id: "t-2", status: "failed" }));
      pool.write(makeTask({ id: "t-3", status: "in_progress" }));
      expect(pool.claimNext()).toBeNull();
    });

    it("按写入顺序 claim", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      pool.write(makeTask({ id: "t-2" }));
      pool.write(makeTask({ id: "t-3" }));
      expect(pool.claimNext()!.id).toBe("t-1");
      expect(pool.claimNext()!.id).toBe("t-2");
      expect(pool.claimNext()!.id).toBe("t-3");
      expect(pool.claimNext()).toBeNull();
    });
  });

  describe("update", () => {
    it("更新 status", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "in_progress" }));
      pool.update("t-1", { status: "done" });
      expect(pool.getAll()[0].status).toBe("done");
    });

    it("更新 result", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      pool.update("t-1", { result: "task output" });
      expect(pool.getAll()[0].result).toBe("task output");
    });

    it("同时更新 status 和 result", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "in_progress" }));
      pool.update("t-1", { status: "done", result: "ok" });
      const task = pool.getAll()[0];
      expect(task.status).toBe("done");
      expect(task.result).toBe("ok");
    });

    it("任务不存在时静默忽略", () => {
      const pool = new TaskPool();
      expect(() => pool.update("t-999", { status: "done" })).not.toThrow();
    });

    it("只传 status 不改 result", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "pending" }));
      pool.update("t-1", { result: "some output" });
      pool.update("t-1", { status: "done" });
      const task = pool.getAll()[0];
      expect(task.status).toBe("done");
      expect(task.result).toBe("some output");
    });
  });

  describe("getAll", () => {
    it("返回快照（不影响原数据）", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      const snapshot = pool.getAll();
      snapshot[0].status = "done";
      // 原数据不受影响
      expect(pool.getAll()[0].status).toBe("pending");
    });
  });

  describe("count", () => {
    it("空池", () => {
      const pool = new TaskPool();
      expect(pool.count()).toEqual({ total: 0, done: 0, failed: 0 });
    });

    it("混合状态", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "pending" }));
      pool.write(makeTask({ id: "t-2", status: "done" }));
      pool.write(makeTask({ id: "t-3", status: "done" }));
      pool.write(makeTask({ id: "t-4", status: "failed" }));
      pool.write(makeTask({ id: "t-5", status: "in_progress" }));
      expect(pool.count()).toEqual({ total: 5, done: 2, failed: 1 });
    });
  });
});
