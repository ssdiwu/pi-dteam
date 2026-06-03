/**
 * orchestrator.ts 单元测试
 *
 * mock brancher 和 leaf，测主循环逻辑：
 * - 单任务 execute
 * - 单任务 decompose → 子任务 execute
 * - 失败处理
 * - 安全上限
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// mock brancher 和 leaf
vi.mock("../src/brancher.js", () => ({
  decide: vi.fn(),
}));

vi.mock("../src/leaf.js", () => ({
  execute: vi.fn(),
}));

import { run } from "../src/orchestrator.js";
import { decide } from "../src/brancher.js";
import { execute } from "../src/leaf.js";

const mockDecide = vi.mocked(decide);
const mockExecute = vi.mocked(execute);

// 最小 ctx mock
const mockCtx = {
  model: { provider: "test", id: "mock-model" },
  modelRegistry: {},
  cwd: "/tmp",
  ui: { notify: vi.fn(), setStatus: vi.fn() },
};

describe("orchestrator", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("单任务 execute → done", async () => {
    mockDecide.mockResolvedValue({ kind: "execute", reason: "simple task" });
    mockExecute.mockResolvedValue("file written successfully");

    const result = await run("写一个 hello world", mockCtx);

    expect(result.status).toBe("done");
    expect(result.workItems).toHaveLength(1);
    expect(result.workItems[0].status).toBe("done");
    expect(result.workItems[0].result).toBe("file written successfully");
    expect(result.summary).toBe("1/1 done, 0 failed");
  });

  it("decompose → 3 个子任务全部 execute → done", async () => {
    // 第一次调用：root task → decompose
    mockDecide.mockResolvedValueOnce({
      kind: "decompose",
      reason: "too big",
      subTasks: [
        { title: "step 1", description: "do step 1" },
        { title: "step 2", description: "do step 2" },
        { title: "step 3", description: "do step 3" },
      ],
    });
    // 后续 3 次：子任务 → execute
    mockDecide.mockResolvedValue({ kind: "execute", reason: "small enough" });
    mockExecute.mockResolvedValue("done");

    const result = await run("实现 JWT 认证", mockCtx);

    expect(result.status).toBe("done");
    expect(result.workItems).toHaveLength(4); // 1 root + 3 sub
    expect(result.workItems[0].status).toBe("done");
    // root task 的 result 包含 "decomposed"
    expect(result.workItems[0].result).toContain("decomposed");
    // 所有子任务 done
    const subs = result.workItems.filter((t) => t.parentId !== null);
    expect(subs).toHaveLength(3);
    expect(subs.every((t) => t.status === "done")).toBe(true);
    expect(result.summary).toBe("4/4 done, 0 failed");
  });

  it("一个子任务失败 → status = failed", async () => {
    mockDecide.mockResolvedValueOnce({
      kind: "decompose",
      reason: "split",
      subTasks: [
        { title: "step 1", description: "ok" },
        { title: "step 2", description: "fail" },
      ],
    });
    mockDecide.mockResolvedValue({ kind: "execute", reason: "go" });
    mockExecute
      .mockResolvedValueOnce("step 1 done")
      .mockRejectedValueOnce(new Error("something broke"));

    const result = await run("do something", mockCtx);

    expect(result.status).toBe("failed");
    expect(result.summary).toBe("2/3 done, 1 failed");
  });

  it("brancher 抛错 → task 标记 failed，继续下一个", async () => {
    mockDecide
      .mockRejectedValueOnce(new Error("LLM error"))
      .mockResolvedValueOnce({ kind: "execute", reason: "ok" });
    mockExecute.mockResolvedValue("done");

    const result = await run("two tasks", mockCtx);

    // root task failed，没有子任务
    expect(result.status).toBe("failed");
    expect(result.workItems).toHaveLength(1);
    expect(result.workItems[0].status).toBe("failed");
    expect(result.workItems[0].result).toContain("LLM error");
  });

  it("两层递归 decompose", async () => {
    // 清理之前的 mock 调用记录
    mockDecide.mockReset();
    mockExecute.mockReset();

    // root → decompose
    mockDecide.mockResolvedValueOnce({
      kind: "decompose",
      reason: "big",
      subTasks: [
        { title: "part A", description: "part A desc" },
        { title: "part B", description: "part B desc" },
      ],
    });
    // part A → decompose again
    mockDecide.mockResolvedValueOnce({
      kind: "decompose",
      reason: "still big",
      subTasks: [
        { title: "A.1", description: "A.1" },
        { title: "A.2", description: "A.2" },
      ],
    });
    // 剩余都是 execute
    mockDecide.mockResolvedValue({ kind: "execute", reason: "small" });
    mockExecute.mockResolvedValue("leaf result");

    const result = await run("复杂任务", mockCtx);

    expect(result.status).toBe("done");
    // root + part A + part B + A.1 + A.2 = 5
    expect(result.workItems).toHaveLength(5);
    expect(result.summary).toBe("5/5 done, 0 failed");
  });

  it("空 goal 也跑通", async () => {
    mockDecide.mockReset();
    mockExecute.mockReset();

    mockDecide.mockResolvedValue({ kind: "execute", reason: "empty" });
    mockExecute.mockResolvedValue("nothing to do");

    const result = await run("", mockCtx);

    expect(result.status).toBe("done");
    expect(result.workItems).toHaveLength(1);
  });
});
