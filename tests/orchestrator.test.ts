/**
 * orchestrator.test.ts — 测试新的二维编排
 *
 * mock planner + leaf，测试 solo/chain/team + direct/build_check/adaptive
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ExecutionPlan, StepResult, RoleName, Strategy } from "../src/tools.js";

// ═══ mock planner ═══
vi.mock("../src/planner.js", () => ({
  plan: vi.fn(),
}));

// ═══ mock leaf ═══
vi.mock("../src/leaf.js", () => ({
  execute: vi.fn(),
}));

// ═══ mock ui-store（避免副作用） ═══
vi.mock("../src/ui-store.js", () => ({
  uiStore: {
    startRun: vi.fn(),
    finishRun: vi.fn(),
    addWorker: vi.fn(),
    updateWorker: vi.fn(),
    getState: vi.fn(() => ({ goal: null, workers: [], startedAt: 0, finishedAt: null })),
  },
}));

import { plan } from "../src/planner.js";
import { execute } from "../src/leaf.js";
import { run } from "../src/orchestrator.js";

const mockPlan = plan as ReturnType<typeof vi.fn>;
const mockExecute = execute as ReturnType<typeof vi.fn>;

const mockCtx: any = {
  model: { provider: "minimax-cn", id: "MiniMax-M3" },
  modelRegistry: { find: () => ({ provider: "minimax-cn", id: "MiniMax-M3" }), authStorage: {}, getAll: () => [] },
  cwd: "/tmp",
  hasUI: false,
  ui: { notify: vi.fn(), setStatus: vi.fn() },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("orchestrator", () => {
  it("solo + direct → done", async () => {
    mockPlan.mockResolvedValue({
      mode: "solo",
      reason: "简单任务",
      steps: [{ role: "build", task: "写 hello.txt", strategy: "direct" }],
    });
    mockExecute.mockResolvedValue("文件已创建");

    const result = await run("写一个 hello world 文件", mockCtx);

    expect(result.status).toBe("done");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].status).toBe("done");
    expect(result.steps[0].output).toBe("文件已创建");
    expect(result.summary).toContain("1/1");
  });

  it("chain + direct → 串行执行，前一步输出注入下一步", async () => {
    mockPlan.mockResolvedValue({
      mode: "chain",
      reason: "需要先探索再执行",
      steps: [
        { role: "explore", task: "探索项目结构", strategy: "direct" },
        { role: "build", task: "实现功能", strategy: "direct" },
      ],
    });
    mockExecute
      .mockResolvedValueOnce("项目是 Node.js + TypeScript")
      .mockResolvedValueOnce("功能已实现");

    const result = await run("给项目加 JWT", mockCtx);

    expect(result.status).toBe("done");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[0].output).toBe("项目是 Node.js + TypeScript");
    // 第二步的 task 应该包含前一步输出
    const secondCall = mockExecute.mock.calls[1];
    expect(secondCall[1]).toContain("上一步输出");
  });

  it("team + direct → 分批并行（≤3）", async () => {
    mockPlan.mockResolvedValue({
      mode: "team",
      reason: "4 个独立子任务",
      steps: [
        { role: "build", task: "任务1", strategy: "direct" },
        { role: "build", task: "任务2", strategy: "direct" },
        { role: "build", task: "任务3", strategy: "direct" },
        { role: "build", task: "任务4", strategy: "direct" },
      ],
    });
    mockExecute.mockResolvedValue("完成");

    const result = await run("给 4 个模块加测试", mockCtx);

    expect(result.status).toBe("done");
    expect(result.steps).toHaveLength(4);
  });

  it("chain 中一步失败 → 后续步骤不执行", async () => {
    mockPlan.mockResolvedValue({
      mode: "chain",
      reason: "串行",
      steps: [
        { role: "explore", task: "探索", strategy: "direct" },
        { role: "build", task: "构建", strategy: "direct" },
        { role: "check", task: "验证", strategy: "direct" },
      ],
    });
    mockExecute
      .mockResolvedValueOnce("探索完成")
      .mockRejectedValueOnce(new Error("构建失败"));

    const result = await run("做一件事", mockCtx);

    expect(result.status).toBe("failed");
    expect(result.steps).toHaveLength(2);
    expect(result.steps[1].status).toBe("failed");
    // check 不应该被执行
    expect(mockExecute).toHaveBeenCalledTimes(2);
  });

  it("plan 失败 → fallback 到 solo+direct+build", async () => {
    mockPlan.mockRejectedValue(new Error("LLM 挂了"));
    mockExecute.mockResolvedValue("还是干了");

    const result = await run("随便干点啥", mockCtx);

    expect(result.status).toBe("done");
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].role).toBe("build");
  });

  it("solo + build_check → 2 轮后通过", async () => {
    mockPlan.mockResolvedValue({
      mode: "solo",
      reason: "编码任务",
      steps: [{ role: "build", task: "写代码", strategy: "build_check" }],
    });
    // 第 1 轮: build → check 发现问题
    // 第 2 轮: build → check 通过
    mockExecute
      .mockResolvedValueOnce("写了代码")    // round 1 build
      .mockResolvedValueOnce("✗ 有 bug")    // round 1 check
      .mockResolvedValueOnce("修了 bug")    // round 2 build
      .mockResolvedValueOnce("✓ 通过");     // round 2 check

    const result = await run("写一个函数", mockCtx);

    expect(result.status).toBe("done");
    expect(result.steps[0].rounds).toBe(2);
    expect(result.steps[0].output).toBe("修了 bug");
  });

  it("空 goal 也跑通", async () => {
    mockPlan.mockResolvedValue({
      mode: "solo",
      reason: "空",
      steps: [{ role: "build", task: "", strategy: "direct" }],
    });
    mockExecute.mockResolvedValue("完成");

    const result = await run("", mockCtx);

    expect(result.status).toBe("done");
    expect(result.steps).toHaveLength(1);
  });
});
