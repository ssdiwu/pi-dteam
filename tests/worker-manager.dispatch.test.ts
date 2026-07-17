import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkerSession } = vi.hoisted(() => ({ mockCreateWorkerSession: vi.fn() }));
vi.mock("../src/session.js", () => ({ createWorkerSession: mockCreateWorkerSession }));

import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { DTEAM_CONFIG } from "../src/config.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";
import { workerReport } from "./worker-report.fixture.js";

function options(overrides: any = {}) {
  return {
    cwd: "/workspace",
    modelRegistry: { find: vi.fn(() => ({ provider: "ctx", id: "model" })) },
    model: { provider: "ctx", id: "model" },
    parentActiveTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    concurrency: new AdaptiveConcurrency({ min: 1, max: 2, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent: vi.fn(),
    ...overrides,
  };
}

function session(output: string) {
  return { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined), setActiveToolsByName: vi.fn(), messages: [{ role: "assistant", content: [{ type: "text", text: output }, { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: output }) }] }] };
}

beforeEach(() => mockCreateWorkerSession.mockReset());

describe("WorkerManager", () => {
  it("批量请求先整体校验，非法项不会启动前序 worker", () => {
    const manager = new WorkerManager(options());
    expect(() => manager.dispatch([
      { title: "合法", task: "任务", tier: "T3" },
      { title: "非法", task: "任务", tier: "T3", addTools: ["not-installed"] },
    ])).toThrow();
    expect(manager.list()).toHaveLength(0);
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("默认 worker 总预算为五分钟，并按档位分配工具额度", () => {
    expect(DTEAM_CONFIG.dispatch.workerTimeoutMs).toBe(300_000);
    expect(DTEAM_CONFIG.dispatch.maxRecoveryBudgetMs).toBe(600_000);
    expect(DTEAM_CONFIG.dispatch.toolCallBudgetByTier).toEqual({ T1: 180, T2: 120, T3: 60 });
    const manager = new WorkerManager(options());
    const accepted = manager.dispatch([
      { title: "T3", task: "任务", tier: "T3" },
      { title: "T2", task: "任务", tier: "T2" },
      { title: "T1", task: "任务", tier: "T1" },
    ]);
    expect(accepted.map((item) => manager.get(item.workerId)?.toolCallBudget)).toEqual([60, 120, 180]);
    manager.shutdown();
  });

  it("拒绝超过恢复上下文上限的 task", () => {
    const manager = new WorkerManager(options());
    expect(() => manager.dispatch([{ title: "过长", task: "x".repeat(DTEAM_CONFIG.dispatch.maxRecoverySummaryChars + 1), tier: "T3" }])).toThrow("task 超过最大长度");
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("dteam_signal 与 dteam_report 不消耗工作工具额度，超额工作工具会终止 worker", async () => {
    let listener!: (event: any) => void;
    const live: any = session("不应完成");
    live.subscribe = vi.fn((callback: (event: any) => void) => { listener = callback; return () => {}; });
    live.prompt = vi.fn(() => new Promise<void>(() => {}));
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options({ timeoutMs: 1_000 }));
    const [accepted] = manager.dispatch([{ title: "工具额度", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(listener).toBeTypeOf("function"));
    for (let i = 0; i < 100; i++) listener({ type: "tool_execution_start", toolName: "dteam_signal" });
    expect(manager.get(accepted!.workerId)?.toolCallCount).toBe(0);
    for (let i = 0; i < 60; i++) listener({ type: "tool_execution_start", toolName: "read" });
    expect(manager.get(accepted!.workerId)).toMatchObject({ toolCallCount: 60, toolCallBudget: 60, state: "running" });
    listener({ type: "tool_execution_start", toolName: "dteam_report" });
    expect(manager.get(accepted!.workerId)).toMatchObject({ toolCallCount: 60, state: "running" });
    listener({ type: "tool_execution_start", toolName: "read" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)?.error).toContain("工具调用额度");
  });

  it("每次 dispatch 读取最新主会话 active tools", () => {
    let current = ["read", "grep", "find", "ls", "edit"];
    const manager = new WorkerManager(options({ getParentActiveTools: () => current }));
    manager.dispatch([{ title: "授权一", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/"] }]);
    current = ["read", "grep", "find", "ls"];
    expect(() => manager.dispatch([{ title: "授权二", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/"] }])).toThrow("未获当前主会话授权");
    manager.shutdown();
  });

  it("无 assistant 文本不会自动跨档到 T1", async () => {
    const noText = { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(noText).mockResolvedValueOnce(session("不应执行"));
    const manager = new WorkerManager(options({ tierModelRoutes: { T3: { primary: "ctx/model" }, T1: { primary: "ctx/model" } } }));
    const [accepted] = manager.dispatch([{ title: "无文本失败", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T3", fallbackTrail: ["T3"], error: expect.stringContaining("assistant 文本") });
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
  });

  it("同档候选失败后不得把前一候选的报告复用给未报告 fallback", async () => {
    const primary = {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      setActiveToolsByName: vi.fn(),
      messages: [{ role: "assistant", content: [{ type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: "primary report" }) }] }],
    };
    const fallback = {
      prompt: vi.fn().mockResolvedValue(undefined),
      abort: vi.fn().mockResolvedValue(undefined),
      setActiveToolsByName: vi.fn(),
      messages: [{ role: "assistant", content: [{ type: "text", text: "fallback result without report" }] }],
    };
    mockCreateWorkerSession.mockResolvedValueOnce(primary).mockResolvedValueOnce(fallback);
    const manager = new WorkerManager(options({ tierModelRoutes: { T3: { primary: "ctx/primary", fallbackModels: ["ctx/fallback"] } } }));
    const [accepted] = manager.dispatch([{ title: "候选报告隔离", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(2);
    expect(manager.get(accepted!.workerId)).toMatchObject({ terminalReason: "missing_report", error: expect.stringContaining("dteam_report") });
  });

  it("旧候选迟到的报告不得写入正在运行的 same-tier fallback", async () => {
    let rejectPrimary!: (error: Error) => void;
    let finishFallback!: () => void;
    const primary = {
      prompt: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectPrimary = reject; })),
      abort: vi.fn().mockResolvedValue(undefined),
      setActiveToolsByName: vi.fn(),
      messages: [],
    };
    const fallback = {
      prompt: vi.fn(() => new Promise<void>((resolve) => { finishFallback = resolve; })),
      abort: vi.fn().mockResolvedValue(undefined),
      setActiveToolsByName: vi.fn(),
      messages: [{ role: "assistant", content: [{ type: "text", text: "fallback result without report" }] }],
    };
    mockCreateWorkerSession.mockResolvedValueOnce(primary).mockResolvedValueOnce(fallback);
    const manager = new WorkerManager(options({ tierModelRoutes: { T3: { primary: "ctx/primary", fallbackModels: ["ctx/fallback"] } } }));
    const [accepted] = manager.dispatch([{ title: "迟到报告隔离", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(primary.prompt).toHaveBeenCalled());
    const staleCandidateId = (manager as any).records.get(accepted!.workerId).activeCandidateId as string;
    rejectPrimary(new Error("primary failed"));
    await vi.waitFor(() => expect(fallback.prompt).toHaveBeenCalled());
    expect(() => manager.receiveReport(accepted!.workerId, workerReport({ summary: "late primary report" }), staleCandidateId)).toThrow("候选已失效");
    finishFallback();
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ terminalReason: "missing_report", error: expect.stringContaining("dteam_report") });
  });

  it("模型候选后缀覆盖 worker thinking，回退保持候选顺序", async () => {
    mockCreateWorkerSession.mockResolvedValue(session("完成"));
    const manager = new WorkerManager(options({ tierModelRoutes: { T3: { primary: "ctx/model:high", fallbackModels: ["ctx/fallback:low"] } } }));
    const [accepted] = manager.dispatch([{ title: "思考强度", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(mockCreateWorkerSession).toHaveBeenCalledWith(expect.objectContaining({ modelStr: "ctx/model", thinkingLevel: "high" }));
  });

  it("立即逐项受理并最终完成，成功结果短窗回传", async () => {
    const events: any[] = [];
    mockCreateWorkerSession.mockResolvedValue(session("完成"));
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const accepted = manager.dispatch([
      { title: "一", task: "任务一", tier: "T3" },
      { title: "二", task: "任务二", tier: "T3" },
    ]);

    expect(accepted).toHaveLength(2);
    expect(new Set(accepted.map((item) => item.workerId)).size).toBe(2);
    await vi.waitFor(() => expect(manager.list().every((item) => item.state === "completed")).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 520));
    expect(events.filter((event) => event.type === "completed")).toHaveLength(1);
    expect(events[0].payload.results).toHaveLength(2);
  });

  it("多个 worker 共用并发上限并释放槽位", async () => {
    let active = 0;
    let peak = 0;
    mockCreateWorkerSession.mockImplementation(() => {
      const current = session("完成");
      current.prompt.mockImplementation(async () => {
        active += 1; peak = Math.max(peak, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active -= 1;
      });
      return current;
    });
    const limiter = new AdaptiveConcurrency({ min: 2, max: 2, initial: 2, cooldownMs: 1000, successStreakToRise: 99 });
    const manager = new WorkerManager(options({ concurrency: limiter }));
    const accepted = manager.dispatch([
      { title: "一", task: "任务一", tier: "T3" },
      { title: "二", task: "任务二", tier: "T3" },
    ]);
    await vi.waitFor(() => expect(manager.list().every((item) => item.state === "completed")).toBe(true));
    expect(accepted).toHaveLength(2);
    expect(peak).toBe(2);
    expect(limiter.flying).toBe(0);
  });

  it("硬失败不会自动跨档，主代理自行决定是否派发 T2", async () => {
    mockCreateWorkerSession.mockRejectedValueOnce(new Error("provider down")).mockResolvedValueOnce(session("不应执行"));
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "失败", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T3", fallbackTrail: ["T3"], error: "provider down" });
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
  });
});
