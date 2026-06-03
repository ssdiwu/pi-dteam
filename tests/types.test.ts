/**
 * tools.ts 类型测试
 *
 * 确保 Task / Decision / RunResult 类型定义和运行时一致。
 */

import { describe, it, expect } from "vitest";
import type { Task, Decision, RunResult, TaskStatus } from "../src/tools.js";

describe("types", () => {
  it("Task 所有的 status 值都能赋值", () => {
    const statuses: TaskStatus[] = ["pending", "in_progress", "done", "failed"];
    const task: Task = {
      id: "t-1",
      parentId: null,
      title: "test",
      description: "test",
      status: "pending",
      createdAt: Date.now(),
    };
    for (const s of statuses) {
      task.status = s;
      expect(task.status).toBe(s);
    }
  });

  it("Decision execute 分支", () => {
    const d: Decision = { kind: "execute", reason: "simple" };
    expect(d.kind).toBe("execute");
  });

  it("Decision decompose 分支", () => {
    const d: Decision = {
      kind: "decompose",
      reason: "complex",
      subTasks: [
        { title: "sub1", description: "do sub1" },
        { title: "sub2", description: "do sub2" },
      ],
    };
    expect(d.kind).toBe("decompose");
    expect(d.subTasks).toHaveLength(2);
  });

  it("RunResult 结构", () => {
    const r: RunResult = {
      status: "done",
      workItems: [],
      summary: "0/0 done, 0 failed",
    };
    expect(r.status).toBe("done");
    expect(r.workItems).toHaveLength(0);
  });
});
