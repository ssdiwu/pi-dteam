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
  it("状态变化会通知观察者以刷新外部视图", () => {
    const onChange = vi.fn();
    const manager = new WorkerManager(options({ onChange }));
    manager.dispatch([{ title: "刷新", task: "任务", tier: "T3" }]);
    expect(onChange).toHaveBeenCalled();
    manager.shutdown();
  });

  it("实时文本按恢复摘要上限裁剪", async () => {
    let listener!: (event: any) => void;
    const live: any = session("完成");
    let resolvePrompt!: () => void;
    live.prompt = vi.fn(() => new Promise<void>((resolve) => { resolvePrompt = resolve; }));
    live.subscribe = vi.fn((callback: (event: any) => void) => { listener = callback; return () => {}; });
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "流", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(listener).toBeTypeOf("function"));
    listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x".repeat(DTEAM_CONFIG.dispatch.maxRecoverySummaryChars + 100) } });
    expect(manager.get(accepted!.workerId)?.liveText?.length).toBe(DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    resolvePrompt();
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
  });

  it("投影 thinking、工具事件并节流 onChange", async () => {
    let listener!: (event: any) => void;
    const live: any = session("完成");
    let resolvePrompt!: () => void;
    live.prompt = vi.fn(() => new Promise<void>((resolve) => { resolvePrompt = resolve; }));
    live.subscribe = vi.fn((callback: (event: any) => void) => { listener = callback; return () => {}; });
    const onChange = vi.fn();
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options({ onChange }));
    const [accepted] = manager.dispatch([{ title: "thinking", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(listener).toBeTypeOf("function"));
    onChange.mockClear();
    listener({ type: "tool_execution_start", toolName: "r".repeat(200) });
    expect(manager.get(accepted!.workerId)?.liveTool?.length).toBeLessThanOrEqual(100);
    expect(manager.get(accepted!.workerId)?.lastActivity?.length).toBeLessThanOrEqual(DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    for (let i = 0; i < 200; i++) listener({ type: "message_update", assistantMessageEvent: { type: "thinking_delta", delta: "x".repeat(100) } });
    expect(manager.get(accepted!.workerId)?.liveThinking?.length).toBeLessThanOrEqual(DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(onChange.mock.calls.length).toBeLessThan(50);
    listener({ type: "tool_execution_end" });
    expect(manager.get(accepted!.workerId)?.liveTool).toBeUndefined();
    resolvePrompt();
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
  });

  it("active 只返回未终态 worker", async () => {
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "活跃", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    expect(manager.active().map((worker) => worker.id)).toEqual([accepted!.workerId]);
    manager.cancel(accepted!.workerId);
    expect(manager.active()).toEqual([]);
  });

  it("steer 将指令转发给运行中 session", async () => {
    const hanging: any = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), steer: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "接管", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    await manager.steer(accepted!.workerId, "停止搜索，给出结论");
    expect(hanging.steer).toHaveBeenCalledWith("停止搜索，给出结论");
    manager.shutdown();
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
    expect(manager.get(accepted!.workerId)).toMatchObject({ state: "cancelled", terminalReason: "user_cancelled" });
    expect(manager.get(accepted!.workerId)?.endedAt).toEqual(expect.any(Number));
  });

  it("shutdown 清理延迟实时刷新 timer", async () => {
    let listener!: (event: any) => void;
    const live: any = session("完成");
    live.prompt = vi.fn(() => new Promise<void>(() => {}));
    live.subscribe = vi.fn((callback: (event: any) => void) => { listener = callback; return () => {}; });
    const onChange = vi.fn();
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options({ onChange }));
    const [accepted] = manager.dispatch([{ title: "刷新 timer", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(listener).toBeTypeOf("function"));
    listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "a" } });
    listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "b" } });
    manager.shutdown();
    const callsAfterShutdown = onChange.mock.calls.length;
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(onChange.mock.calls.length).toBe(callsAfterShutdown);
    expect(manager.get(accepted!.workerId)).toMatchObject({ state: "shutdown", terminalReason: "session_shutdown" });
    expect(manager.get(accepted!.workerId)?.endedAt).toEqual(expect.any(Number));
  });

  it("failed error 和 request payload 也经过脱敏", async () => {
    const events: any[] = [];
    mockCreateWorkerSession.mockRejectedValueOnce(new Error("password=hunter2"));
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const [failed] = manager.dispatch([{ title: "失败", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(failed!.workerId)?.state).toBe("failed"));
    const failedEvent = events.find((item) => item.type === "failed");
    expect(JSON.stringify(failedEvent?.payload)).not.toContain("hunter2");

    const waitingSession: any = session("等待");
    waitingSession.prompt = vi.fn(() => new Promise<void>(() => {}));
    mockCreateWorkerSession.mockResolvedValue(waitingSession);
    const [waitingWorker] = manager.dispatch([{ title: "请求", task: "任务", tier: "T1" }]);
    const waiting = manager.receiveSignal(waitingWorker!.workerId, { kind: "request_context", requestId: "secret-request", question: "token=sk-12345678901234567890" });
    await vi.waitFor(() => expect(manager.get(waitingWorker!.workerId)?.state).toBe("waiting"));
    const requestEvent = events.find((item) => item.type === "request");
    expect(JSON.stringify(requestEvent?.payload)).not.toContain("sk-12345678901234567890");
    manager.respond(waitingWorker!.workerId, "secret-request", { type: "provide_context", context: "ok" });
    await expect(waiting).resolves.toMatchObject({ type: "provide_context" });
  });

  it("统一 parent event 边界会脱敏 title 和 payload", async () => {
    const events: any[] = [];
    mockCreateWorkerSession.mockResolvedValue(session("api_key=sk-result-secret"));
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "api_key=sk-title-secret", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    await vi.waitFor(() => expect(events.some((item) => item.type === "completed")).toBe(true));
    const event = events.find((item) => item.type === "completed");
    expect(event.title).not.toContain("sk-title-secret");
    expect(JSON.stringify(event.payload)).not.toContain("sk-result-secret");
  });

  it("父代理回调异常不会改变 worker 终态", async () => {
    mockCreateWorkerSession.mockResolvedValue(session("完成"));
    const manager = new WorkerManager(options({ onParentEvent: () => { throw new Error("callback failed"); } }));
    const [accepted] = manager.dispatch([{ title: "回调异常", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
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

  it("创建 session 期间取消会立即释放并发槽", async () => {
    let resolveFirst!: (value: any) => void;
    const first = new Promise((resolve) => { resolveFirst = resolve; });
    const second = session("第二个完成");
    mockCreateWorkerSession.mockReturnValueOnce(first).mockResolvedValueOnce(second);
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    const manager = new WorkerManager(options({ concurrency: limiter, timeoutMs: 10_000 }));
    const [cancelled] = manager.dispatch([{ title: "创建中取消", task: "任务一", tier: "T1" }]);
    await vi.waitFor(() => expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1));
    manager.cancel(cancelled!.workerId);
    const [completed] = manager.dispatch([{ title: "后续任务", task: "任务二", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(completed!.workerId)?.state).toBe("completed"));
    expect(limiter.flying).toBe(0);
    resolveFirst(session("迟到"));
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
