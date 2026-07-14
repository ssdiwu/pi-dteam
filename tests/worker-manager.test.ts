import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkerSession } = vi.hoisted(() => ({ mockCreateWorkerSession: vi.fn() }));
vi.mock("../src/session.js", () => ({ createWorkerSession: mockCreateWorkerSession }));

import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";

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
  return { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined), setActiveToolsByName: vi.fn(), messages: [{ role: "assistant", content: [{ type: "text", text: output }] }] };
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

  it("每次 dispatch 读取最新主会话 active tools", () => {
    let current = ["read", "grep", "find", "ls", "edit"];
    const manager = new WorkerManager(options({ getParentActiveTools: () => current }));
    manager.dispatch([{ title: "授权一", task: "任务", tier: "T3", addTools: ["edit"] }]);
    current = ["read", "grep", "find", "ls"];
    expect(() => manager.dispatch([{ title: "授权二", task: "任务", tier: "T3", addTools: ["edit"] }])).toThrow("未获当前主会话授权");
    manager.shutdown();
  });

  it("状态变化会通知观察者以刷新外部视图", () => {
    const onChange = vi.fn();
    const manager = new WorkerManager(options({ onChange }));
    manager.dispatch([{ title: "刷新", task: "任务", tier: "T3" }]);
    expect(onChange).toHaveBeenCalled();
    manager.shutdown();
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

  it("共享并发并在硬失败后回退 T1", async () => {
    mockCreateWorkerSession.mockRejectedValueOnce(new Error("provider down")).mockResolvedValueOnce(session("T1 完成"));
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "回退", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T1", fallbackTrail: ["T3", "T1"], result: "T1 完成" });
  });

  it("session 创建超时进入 timed_out 并释放槽位", async () => {
    let resolveCreation!: (value: any) => void;
    mockCreateWorkerSession.mockReturnValue(new Promise((resolve) => { resolveCreation = resolve; }));
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    const manager = new WorkerManager(options({ timeoutMs: 5, concurrency: limiter }));
    const [accepted] = manager.dispatch([{ title: "创建超时", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ terminalReason: "timeout" });
    expect(limiter.flying).toBe(0);
    resolveCreation(session("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("prompt 超时进入 timed_out，并以有界 abort 结束", async () => {
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ timeoutMs: 5 }));
    const [accepted] = manager.dispatch([{ title: "prompt 超时", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(hanging.abort).toHaveBeenCalled();
  });

  it("取消会立即打断 hanging prompt 并释放并发槽", async () => {
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ concurrency: limiter, timeoutMs: 10_000 }));
    const [accepted] = manager.dispatch([{ title: "取消 hanging", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    manager.cancel(accepted!.workerId);
    await vi.waitFor(() => expect(limiter.flying).toBe(0));
    expect(manager.get(accepted!.workerId)?.state).toBe("cancelled");
  });

  it("失败立即回传且 shutdown 中止活跃 worker", async () => {
    const onParentEvent = vi.fn();
    mockCreateWorkerSession.mockRejectedValue(new Error("provider down"));
    const failedManager = new WorkerManager(options({ onParentEvent }));
    const [failed] = failedManager.dispatch([{ title: "失败", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(failedManager.get(failed!.workerId)?.state).toBe("failed"));
    expect(onParentEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "failed" }));

    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ onParentEvent }));
    const [accepted] = manager.dispatch([{ title: "挂起", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("running"));
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    manager.shutdown();
    expect(hanging.abort).toHaveBeenCalled();
    expect(manager.get(accepted!.workerId)).toMatchObject({ state: "shutdown", cancelReason: "session_shutdown", terminalReason: "session_shutdown" });
    expect(onParentEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "cancelled", payload: { reason: "session_shutdown", state: "shutdown" } }));
  });

  it("创建 session 期间 shutdown 会中止迟到 session 且不 prompt", async () => {
    let resolveSession!: (value: any) => void;
    const late = session("不应执行");
    mockCreateWorkerSession.mockReturnValueOnce(new Promise((resolve) => { resolveSession = resolve; }));
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "创建中", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1));
    manager.shutdown();
    resolveSession(late);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(late.abort).toHaveBeenCalledTimes(1);
    expect(late.prompt).not.toHaveBeenCalled();
    expect(manager.get(accepted!.workerId)).toMatchObject({ state: "shutdown", cancelReason: "session_shutdown", terminalReason: "session_shutdown" });
  });

  it("shutdown 不会让排队 worker 重新启动", async () => {
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    const first = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(first);
    const manager = new WorkerManager(options({ concurrency: limiter }));
    const accepted = manager.dispatch([
      { title: "运行", task: "任务一", tier: "T1" },
      { title: "排队", task: "任务二", tier: "T1" },
    ]);
    await vi.waitFor(() => expect(manager.get(accepted[0]!.workerId)?.state).toBe("running"));
    expect(manager.get(accepted[1]!.workerId)?.state).toBe("queued");
    manager.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.get(accepted[1]!.workerId)).toMatchObject({ state: "shutdown", cancelReason: "session_shutdown", terminalReason: "session_shutdown" });
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
  });
});
