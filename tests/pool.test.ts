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

  describe("read", () => {
    it("返回单个任务快照", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", title: "hello" }));
      const task = pool.read("t-1");
      expect(task).not.toBeNull();
      expect(task!.title).toBe("hello");
    });

    it("不存在的 id 返回 null", () => {
      const pool = new TaskPool();
      expect(pool.read("t-none")).toBeNull();
    });

    it("返回快照不影响原数据", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      const task = pool.read("t-1");
      task!.status = "done";
      expect(pool.read("t-1")!.status).toBe("pending");
    });
  });

  describe("search", () => {
    it("按 title 匹配", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", title: "实现登录" }));
      pool.write(makeTask({ id: "t-2", title: "编写测试" }));
      expect(pool.search("登录")).toHaveLength(1);
      expect(pool.search("登录")[0].id).toBe("t-1");
    });

    it("按 description 匹配", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", description: "用户认证模块" }));
      expect(pool.search("认证")).toHaveLength(1);
    });

    it("大小写不敏感", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", title: "Implement Auth" }));
      expect(pool.search("implement")).toHaveLength(1);
    });

    it("无匹配返回空数组", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", title: "test" }));
      expect(pool.search("xyz")).toEqual([]);
    });
  });

  describe("list", () => {
    it("按 status 过滤", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "pending" }));
      pool.write(makeTask({ id: "t-2", status: "done" }));
      pool.write(makeTask({ id: "t-3", status: "pending" }));
      expect(pool.list({ status: "pending" })).toHaveLength(2);
    });

    it("按 parentId 过滤", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", parentId: null }));
      pool.write(makeTask({ id: "t-2", parentId: "t-1" }));
      pool.write(makeTask({ id: "t-3", parentId: "t-1" }));
      expect(pool.list({ parentId: "t-1" })).toHaveLength(2);
    });

    it("不传 opts 返回全部", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      pool.write(makeTask({ id: "t-2" }));
      expect(pool.list()).toHaveLength(2);
    });

    it("组合过滤", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "done", parentId: "p-1" }));
      pool.write(makeTask({ id: "t-2", status: "pending", parentId: "p-1" }));
      pool.write(makeTask({ id: "t-3", status: "done", parentId: "p-2" }));
      expect(pool.list({ status: "done", parentId: "p-1" })).toHaveLength(1);
    });
  });

  describe("complete", () => {
    it("标记完成并附上证据", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1", status: "in_progress" }));
      const result = pool.complete("t-1", "all tests pass");
      expect(result).not.toBeNull();
      expect(result!.status).toBe("done");
      expect(result!.result).toBe("all tests pass");
    });

    it("不存在的 id 返回 null", () => {
      const pool = new TaskPool();
      expect(pool.complete("t-none", "")).toBeNull();
    });

    it("内部状态同步更新", () => {
      const pool = new TaskPool();
      pool.write(makeTask({ id: "t-1" }));
      pool.complete("t-1", "done");
      expect(pool.read("t-1")!.status).toBe("done");
      expect(pool.count().done).toBe(1);
    });
  });
});
