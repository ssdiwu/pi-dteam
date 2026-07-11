import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkerSession } = vi.hoisted(() => ({
  mockCreateWorkerSession: vi.fn(),
}));

vi.mock("../src/session.js", () => ({
  createWorkerSession: mockCreateWorkerSession,
  pickAvailableModel: vi.fn(),
  getRoleTools: vi.fn(),
}));

import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { dispatch } from "../src/leaf.js";

function sessionWithOutput(output: string) {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    messages: [{ role: "assistant", content: [{ type: "text", text: output }] }],
  };
}

function context(overrides: any = {}) {
  return {
    cwd: "/workspace",
    modelRegistry: { find: vi.fn(), getAll: vi.fn(() => []), authStorage: {} },
    model: { provider: "ctx", id: "model" },
    ...overrides,
  };
}

beforeEach(() => {
  mockCreateWorkerSession.mockReset();
});

describe("dispatch", () => {
  it("创建 T3 fresh、逻辑隔离的只读 worker", async () => {
    const session = sessionWithOutput("已完成机械任务");
    mockCreateWorkerSession.mockResolvedValue(session);

    const result = await dispatch({ task: "列出待改文件", tier: "T3" }, context());

    expect(result).toMatchObject({
      status: "done",
      requestedTier: "T3",
      tier: "T3",
      thinking: "low",
      tools: ["read", "grep", "find", "ls"],
      result: "已完成机械任务",
      fellBack: false,
    });
    expect(session.prompt).toHaveBeenCalledWith("列出待改文件");
    expect(mockCreateWorkerSession).toHaveBeenCalledWith(expect.objectContaining({
      tier: "T3",
      modelStr: "ctx/model",
      logicalIsolation: true,
      thinkingLevel: "low",
      builtInTools: ["read", "grep", "find", "ls"],
    }));
  });

  it("调用方显式 tools 是 T1 fresh 验收的权限上限", async () => {
    mockCreateWorkerSession.mockResolvedValue(sessionWithOutput("验收通过"));
    const readOnlyTools = ["read", "grep", "find", "ls"];

    const result = await dispatch(
      { task: "验收产出，只报告证据", tier: "T1", tools: readOnlyTools },
      context(),
    );

    expect(result.status).toBe("done");
    expect(result.tools).toEqual(readOnlyTools);
    expect(mockCreateWorkerSession).toHaveBeenCalledWith(expect.objectContaining({
      tier: "T1",
      logicalIsolation: true,
      builtInTools: readOnlyTools,
    }));
  });

  it("同档 provider fallback 在转 T1 前先尝试", async () => {
    mockCreateWorkerSession.mockImplementation(async (options: any) => {
      if (options.modelStr === "missing/model") throw new Error("model unavailable");
      return sessionWithOutput("T3 fallback provider 完成");
    });

    const result = await dispatch(
      { task: "读取三个独立文件", tier: "T3" },
      context({ tierModelRoutes: { T3: { primary: "missing/model", fallbackModels: ["fallback/ok"] } } }),
    );

    expect(result).toMatchObject({ status: "done", tier: "T3", model: "fallback/ok", fellBack: false });
    expect(result.attempts).toEqual([expect.objectContaining({ tier: "T3", model: "missing/model" })]);
    expect(mockCreateWorkerSession.mock.calls.map(([options]) => options.tier)).toEqual(["T3", "T3"]);
  });

  it("T3 硬失败后自动以 T1 重做，并保持显式 tools 上限", async () => {
    mockCreateWorkerSession
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockResolvedValueOnce(sessionWithOutput("T1 回退完成"));
    const readOnlyTools = ["read", "grep", "find", "ls"];

    const result = await dispatch(
      { task: "检查结果", tier: "T3", thinking: "low", tools: readOnlyTools },
      context(),
    );

    expect(result).toMatchObject({ status: "done", requestedTier: "T3", tier: "T1", thinking: "high", fellBack: true });
    expect(result.attempts).toEqual([expect.objectContaining({ tier: "T3", error: "429 rate limit" })]);
    expect(mockCreateWorkerSession.mock.calls.map(([options]) => options.tier)).toEqual(["T3", "T1"]);
    expect(mockCreateWorkerSession.mock.calls[1][0].thinkingLevel).toBe("high");
    expect(mockCreateWorkerSession.mock.calls[1][0].builtInTools).toEqual(readOnlyTools);
  });

  it("T3 未显式 tools 时回退 T1 仍保持 T3 默认只读", async () => {
    mockCreateWorkerSession
      .mockRejectedValueOnce(new Error("T3 provider down"))
      .mockResolvedValueOnce(sessionWithOutput("T1 只读回退完成"));

    const result = await dispatch({ task: "只读检查", tier: "T3" }, context());

    expect(result).toMatchObject({ status: "done", tier: "T1", tools: ["read", "grep", "find", "ls"] });
    expect(mockCreateWorkerSession.mock.calls[1][0].builtInTools).toEqual(["read", "grep", "find", "ls"]);
  });

  it("T1 硬失败不会递归回退", async () => {
    mockCreateWorkerSession.mockRejectedValue(new Error("provider down"));

    const result = await dispatch({ task: "验收", tier: "T1" }, context());

    expect(result).toMatchObject({ status: "failed", requestedTier: "T1", tier: "T1", fellBack: false });
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
  });

  it("worker 超时会 abort 当前 session 并回退 T1", async () => {
    const hanging = {
      prompt: vi.fn(() => new Promise<void>(() => {})),
      abort: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    mockCreateWorkerSession
      .mockResolvedValueOnce(hanging)
      .mockResolvedValueOnce(sessionWithOutput("T1 超时回退完成"));

    const result = await dispatch(
      { task: "读取结果", tier: "T3" },
      context({ timeoutMs: 5 }),
    );

    expect(hanging.abort).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "done", tier: "T1", fellBack: true });
    expect(result.attempts).toEqual([expect.objectContaining({ tier: "T3", error: expect.stringContaining("执行超时") })]);
  });

  it("Pi 取消信号 abort 当前 worker 且不继续回退", async () => {
    const controller = new AbortController();
    const hanging = {
      prompt: vi.fn(() => new Promise<void>(() => {})),
      abort: vi.fn().mockResolvedValue(undefined),
      messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(hanging);

    const pending = dispatch({ task: "可取消任务", tier: "T3" }, context({ signal: controller.signal }));
    await new Promise((resolve) => setTimeout(resolve, 0));
    controller.abort();
    const result = await pending;

    expect(hanging.abort).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ status: "failed", requestedTier: "T3", tier: "T3", fellBack: false, error: "dteam_dispatch 已取消" });
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
  });

  it("共享 AdaptiveConcurrency 允许并行 dispatch 并在 429 后降并发", async () => {
    let active = 0;
    let peak = 0;
    const delayedSession = (output: string) => ({
      prompt: vi.fn(async () => {
        active += 1;
        peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 10));
        active -= 1;
      }),
      messages: [{ role: "assistant", content: [{ type: "text", text: output }] }],
    });
    const parallelLimiter = new AdaptiveConcurrency({ min: 2, max: 2, cooldownMs: 10_000, successStreakToRise: 1 });
    mockCreateWorkerSession
      .mockResolvedValueOnce(delayedSession("并发一"))
      .mockResolvedValueOnce(delayedSession("并发二"));

    await Promise.all([
      dispatch({ task: "独立任务一", tier: "T3" }, context({ concurrency: parallelLimiter })),
      dispatch({ task: "独立任务二", tier: "T3" }, context({ concurrency: parallelLimiter })),
    ]);
    expect(peak).toBe(2);
    expect(parallelLimiter.flying).toBe(0);

    const rateLimiter = new AdaptiveConcurrency({ min: 1, max: 2, cooldownMs: 10_000, successStreakToRise: 1 });
    mockCreateWorkerSession.mockResolvedValueOnce(sessionWithOutput("升并发"));
    await dispatch({ task: "成功任务", tier: "T3" }, context({ concurrency: rateLimiter }));
    expect(rateLimiter.limit).toBe(2);

    mockCreateWorkerSession
      .mockRejectedValueOnce(new Error("429 rate limit"))
      .mockResolvedValueOnce(sessionWithOutput("T1 兜底"));
    await dispatch({ task: "限流任务", tier: "T3" }, context({ concurrency: rateLimiter }));
    expect(rateLimiter.limit).toBe(1);
    expect(rateLimiter.flying).toBe(0);
  });
});
