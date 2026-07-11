import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockDispatch } = vi.hoisted(() => ({
  mockDispatch: vi.fn(),
}));

vi.mock("../src/leaf.js", () => ({
  dispatch: mockDispatch,
}));

import registerExtension from "../index.js";

function register() {
  const pi = {
    registerTool: vi.fn(),
  };
  registerExtension(pi as any);
  return {
    tool: pi.registerTool.mock.calls[0][0],
    pi,
  };
}

function context() {
  return {
    cwd: "/workspace",
    model: { provider: "ctx", id: "model" },
    modelRegistry: { authStorage: {} },
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  };
}

beforeEach(() => {
  mockDispatch.mockReset();
  delete (globalThis as any).__piDteamDispatchRuntime;
  delete process.env.DTEAM_T1_MODEL;
  delete process.env.DTEAM_T1_FALLBACK_MODELS;
  delete process.env.DTEAM_T2_MODEL;
  delete process.env.DTEAM_T2_FALLBACK_MODELS;
  delete process.env.DTEAM_T3_MODEL;
  delete process.env.DTEAM_T3_FALLBACK_MODELS;
});

describe("dteam_dispatch extension entry", () => {
  it("只注册 dteam_dispatch 工具", () => {
    const { pi, tool } = register();

    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(tool.name).toBe("dteam_dispatch");
    expect(tool.parameters.required).toEqual(["task", "tier"]);
  });

  it("传递显式 tier、thinking、tools 到 fresh dispatch", async () => {
    mockDispatch.mockResolvedValue({
      status: "done",
      task: "列出文件",
      requestedTier: "T3",
      tier: "T3",
      thinking: "low",
      tools: ["read", "grep"],
      result: "完成",
      fellBack: false,
      attempts: [],
      elapsedMs: 1,
    });
    process.env.DTEAM_T3_MODEL = "fast/t3";
    process.env.DTEAM_T3_FALLBACK_MODELS = "fallback/t3";
    const { tool } = register();
    const ctx = context();
    const controller = new AbortController();

    const response = await tool.execute(
      "call-1",
      { task: "列出文件", tier: "T3", thinking: "low", tools: ["read", "grep"] },
      controller.signal,
      undefined,
      ctx,
    );

    expect(mockDispatch).toHaveBeenCalledWith(
      { task: "列出文件", tier: "T3", thinking: "low", tools: ["read", "grep"] },
      expect.objectContaining({
        cwd: "/workspace",
        model: { provider: "ctx", id: "model" },
        modelRegistry: ctx.modelRegistry,
        signal: controller.signal,
        tierModelRoutes: { T3: { primary: "fast/t3", fallbackModels: ["fallback/t3"] } },
      }),
    );
    expect(response.isError).toBe(false);
    expect(JSON.parse(response.content[0].text)).toMatchObject({ status: "done", tier: "T3" });
    expect(ctx.ui.setStatus).toHaveBeenNthCalledWith(1, "dteam", "dispatch T3: 列出文件");
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("dteam", undefined);
  });

  it("拒绝无效参数，不调用 dispatch", async () => {
    const { tool } = register();
    const ctx = context();

    const response = await tool.execute("call-2", { task: "", tier: "T4" }, undefined, undefined, ctx);

    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("task 必须是非空字符串");
    expect(mockDispatch).not.toHaveBeenCalled();
  });

  it("并发工具调用共享默认 initial=2 的 limiter", async () => {
    mockDispatch.mockResolvedValue({
      status: "done", task: "x", requestedTier: "T3", tier: "T3", thinking: "low",
      tools: ["read"], result: "完成", fellBack: false, attempts: [], elapsedMs: 1,
    });
    const { tool } = register();
    const ctx = context();

    await Promise.all([
      tool.execute("call-a", { task: "独立一", tier: "T3" }, undefined, undefined, ctx),
      tool.execute("call-b", { task: "独立二", tier: "T3" }, undefined, undefined, ctx),
    ]);

    const firstRuntime = mockDispatch.mock.calls[0][1].concurrency;
    const secondRuntime = mockDispatch.mock.calls[1][1].concurrency;
    expect(firstRuntime).toBe(secondRuntime);
    expect(firstRuntime.limit).toBe(2);
  });

  it("dispatch 返回 failed 时保留结果并标记工具错误", async () => {
    mockDispatch.mockResolvedValue({
      status: "failed",
      task: "失败任务",
      requestedTier: "T3",
      tier: "T1",
      thinking: "high",
      tools: ["read"],
      result: "",
      fellBack: true,
      attempts: [{ tier: "T3", error: "timeout" }],
      error: "all failed",
      elapsedMs: 2,
    });
    const { tool } = register();

    const response = await tool.execute("call-3", { task: "失败任务", tier: "T3" }, undefined, undefined, context());

    expect(response.isError).toBe(true);
    expect(JSON.parse(response.content[0].text)).toMatchObject({ tier: "T1", fellBack: true });
  });
});
