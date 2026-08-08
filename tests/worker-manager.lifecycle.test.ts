import { waitFor } from "./test-helpers.js";
import { mockCreateWorkerSession } from "./mock-modules.js";
import { beforeEach, describe, expect, it , mock } from "bun:test";


import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { DTEAM_CONFIG } from "../src/config.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";
import { workerReport } from "./worker-report.fixture.js";

function options(overrides: any = {}) {
  return {
    cwd: "/workspace",
    modelRegistry: { find: mock(() => ({ provider: "ctx", id: "model" })) },
    model: { provider: "ctx", id: "model" },
    parentActiveTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    concurrency: new AdaptiveConcurrency({ min: 1, max: 2, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent: mock(),
    ...overrides,
  };
}

function session(output: string) {
  return { prompt: mock().mockResolvedValue(undefined), abort: mock().mockResolvedValue(undefined), setActiveToolsByName: mock(), messages: [{ role: "assistant", content: [{ type: "text", text: output }, { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: output }) }] }] };
}

beforeEach(() => mockCreateWorkerSession.mockReset());

describe("WorkerManager", () => {
  it("状态变化会通知观察者以刷新外部视图", () => {
    const onChange = mock();
    const manager = new WorkerManager(options({ onChange }));
    manager.dispatch([{ title: "刷新", task: "任务", tier: "T3" }]);
    expect(onChange).toHaveBeenCalled();
    manager.shutdown();
  });

  it("实时文本按恢复摘要上限裁剪", async () => {
    let listener!: (event: any) => void;
    const live: any = session("完成");
    let resolvePrompt!: () => void;
    live.prompt = mock(() => new Promise<void>((resolve) => { resolvePrompt = resolve; }));
    live.subscribe = mock((callback: (event: any) => void) => { listener = callback; return () => {}; });
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "流", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(listener).toBeTypeOf("function"));
    listener({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: "x".repeat(DTEAM_CONFIG.dispatch.maxRecoverySummaryChars + 100) } });
    expect(manager.get(accepted!.workerId)?.liveText?.length).toBe(DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    resolvePrompt();
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
  });

  it("投影 thinking、工具事件并节流 onChange", async () => {
    let listener!: (event: any) => void;
    const live: any = session("完成");
    let resolvePrompt!: () => void;
    live.prompt = mock(() => new Promise<void>((resolve) => { resolvePrompt = resolve; }));
    live.subscribe = mock((callback: (event: any) => void) => { listener = callback; return () => {}; });
    const onChange = mock();
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options({ onChange }));
    const [accepted] = manager.dispatch([{ title: "thinking", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(listener).toBeTypeOf("function"));
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
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
  });

  it("active 只返回未终态 worker", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "活跃", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    expect(manager.active().map((worker) => worker.id)).toEqual([accepted!.workerId]);
    manager.cancel(accepted!.workerId);
    expect(manager.active()).toEqual([]);
  });

  it("steer 将指令转发给运行中 session", async () => {
    const hanging: any = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), steer: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "接管", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    await manager.steer(accepted!.workerId, "停止搜索，给出结论");
    expect(hanging.steer).toHaveBeenCalledWith("停止搜索，给出结论");
    manager.shutdown();
  });

  it("dteam_control steer 与 graceful_stop 复用同一 running session", async () => {
    const activeSession: any = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), steer: mock().mockResolvedValue(undefined), clearQueue: mock(() => ({ steering: [], followUp: [] })), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(activeSession);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "主动协调", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(activeSession.prompt).toHaveBeenCalled());
    await expect(manager.control(accepted!.workerId, { action: "steer", instruction: "只核对入口，不要扩展范围" })).resolves.toMatchObject({ action: "steer", state: "running" });
    expect(activeSession.steer).toHaveBeenCalledWith("只核对入口，不要扩展范围");
    await expect(manager.control(accepted!.workerId, { action: "graceful_stop", reason: "事实已足够" })).resolves.toMatchObject({ action: "graceful_stop", state: "running" });
    expect(activeSession.steer).toHaveBeenLastCalledWith(expect.stringContaining("outcome=\"partial\""));
    expect(activeSession.steer).toHaveBeenLastCalledWith(expect.stringContaining("事实已足够"));
    expect(manager.signalLog.eventsFor(accepted!.workerId).map((event) => event.kind)).toContain("graceful_stop_requested");
    manager.shutdown();
  });

  it("graceful_stop 不扩大权限并允许 partial report", async () => {
    const activeSession: any = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), steer: mock().mockResolvedValue(undefined), setActiveToolsByName: mock(), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(activeSession);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "优雅收敛", task: "任务", tier: "T1", addTools: ["edit"], writeScope: ["src/feature.ts"] }]);
    await waitFor(() => expect(activeSession.prompt).toHaveBeenCalled());
    const before = manager.get(accepted!.workerId)!;
    await manager.control(accepted!.workerId, { action: "graceful_stop", reason: "路由已确定" });
    expect(manager.get(accepted!.workerId)).toMatchObject({ state: "running", activeTools: before.activeTools, writeScope: ["src/feature.ts"] });
    manager.receiveReport(accepted!.workerId, workerReport({ outcome: "partial", summary: "已在安全点收敛", verification: { status: "partial", remaining: ["尚未运行完整测试"] } }));
    expect(manager.get(accepted!.workerId)).toMatchObject({ report: { outcome: "partial", summary: "已在安全点收敛", verification: { status: "partial", remaining: ["尚未运行完整测试"] } } });
    manager.shutdown();
  });

  it("dteam_control 只允许 running worker", async () => {
    const first: any = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(first);
    const manager = new WorkerManager(options({ concurrency: new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }) }));
    const accepted = manager.dispatch([{ title: "运行", task: "任务", tier: "T1" }, { title: "排队", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(first.prompt).toHaveBeenCalled());
    await expect(manager.control(accepted[1]!.workerId, { action: "cancel", reason: "未运行" })).rejects.toThrow("只允许 running");
    const waiting = manager.receiveSignal(accepted[0]!.workerId, { kind: "request_context", requestId: "ctx", question: "需要上下文" });
    await waitFor(() => expect(manager.get(accepted[0]!.workerId)?.state).toBe("waiting"));
    await expect(manager.control(accepted[0]!.workerId, { action: "steer", instruction: "不应发送" })).rejects.toThrow("只允许 running");
    manager.respond(accepted[0]!.workerId, "ctx", { type: "deny", reason: "测试结束" });
    await expect(waiting).resolves.toMatchObject({ type: "deny" });
    manager.shutdown();
  });

  it("dteam_control cancel 区分主代理来源并清理旧事件", async () => {
    const events: any[] = [];
    const available = mock();
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    const manager = new WorkerManager(options({ concurrency: limiter, onParentEvent: (event: any) => events.push(event), onParentEventAvailable: available }));
    const [accepted] = manager.dispatch([{ title: "主动取消", task: "任务", tier: "T1", addTools: ["edit"], writeScope: ["src/"] }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    await manager.receiveSignal(accepted!.workerId, { kind: "finding", summary: "旧发现", evidence: "a.ts:1", impact: "已失去价值" });
    const result = await manager.control(accepted!.workerId, { action: "cancel", reason: "主代理接管" });
    expect(result).toMatchObject({ action: "cancel", state: "cancelled", cancelInitiator: "main", writeInterrupted: { reason: "主代理接管", writeScope: ["src/"] } });
    expect(manager.get(accepted!.workerId)).toMatchObject({ state: "cancelled", cancelInitiator: "main" });
    await waitFor(() => expect(limiter.flying).toBe(0));
    manager.flushParentEvents();
    expect(events).toEqual([]);
    await expect(manager.wait([accepted!.workerId], 10)).resolves.toMatchObject({ reason: "timeout", events: [] });
  });

  it("取消会立即打断 hanging prompt 并释放并发槽", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ concurrency: limiter, timeoutMs: 10_000 }));
    const [accepted] = manager.dispatch([{ title: "取消 hanging", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    manager.cancel(accepted!.workerId);
    await waitFor(() => expect(limiter.flying).toBe(0));
    expect(manager.get(accepted!.workerId)).toMatchObject({ state: "cancelled", terminalReason: "user_cancelled" });
    expect(manager.get(accepted!.workerId)?.endedAt).toEqual(expect.any(Number));
  });

  it("shutdown 清理延迟实时刷新 timer", async () => {
    let listener!: (event: any) => void;
    const live: any = session("完成");
    live.prompt = mock(() => new Promise<void>(() => {}));
    live.subscribe = mock((callback: (event: any) => void) => { listener = callback; return () => {}; });
    const onChange = mock();
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options({ onChange }));
    const [accepted] = manager.dispatch([{ title: "刷新 timer", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(listener).toBeTypeOf("function"));
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
    await waitFor(() => expect(manager.get(failed!.workerId)?.state).toBe("failed"));
    const failedEvent = events.find((item) => item.type === "failed");
    expect(JSON.stringify(failedEvent?.payload)).not.toContain("hunter2");

    const waitingSession: any = session("等待");
    waitingSession.prompt = mock(() => new Promise<void>(() => {}));
    mockCreateWorkerSession.mockResolvedValue(waitingSession);
    const [waitingWorker] = manager.dispatch([{ title: "请求", task: "任务", tier: "T1" }]);
    const waiting = manager.receiveSignal(waitingWorker!.workerId, { kind: "request_context", requestId: "secret-request", question: "token=sk-12345678901234567890" });
    await waitFor(() => expect(manager.get(waitingWorker!.workerId)?.state).toBe("waiting"));
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
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    await waitFor(() => expect(events.some((item) => item.type === "completed")).toBe(true));
    const event = events.find((item) => item.type === "completed");
    expect(event.title).not.toContain("sk-title-secret");
    expect(JSON.stringify(event.payload)).not.toContain("sk-result-secret");
  });

  it("父代理回调异常不会改变 worker 终态", async () => {
    mockCreateWorkerSession.mockResolvedValue(session("完成"));
    const manager = new WorkerManager(options({ onParentEvent: () => { throw new Error("callback failed"); } }));
    const [accepted] = manager.dispatch([{ title: "回调异常", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
  });

  it("失败立即回传且 shutdown 中止活跃 worker", async () => {
    const onParentEvent = mock();
    mockCreateWorkerSession.mockRejectedValue(new Error("provider down"));
    const failedManager = new WorkerManager(options({ onParentEvent }));
    const [failed] = failedManager.dispatch([{ title: "失败", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(failedManager.get(failed!.workerId)?.state).toBe("failed"));
    expect(onParentEvent).toHaveBeenCalledWith(expect.objectContaining({ type: "failed" }));

    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ onParentEvent }));
    const [accepted] = manager.dispatch([{ title: "挂起", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("running"));
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
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
    await waitFor(() => expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1));
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
    await waitFor(() => expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1));
    manager.cancel(cancelled!.workerId);
    const [completed] = manager.dispatch([{ title: "后续任务", task: "任务二", tier: "T1" }]);
    await waitFor(() => expect(manager.get(completed!.workerId)?.state).toBe("completed"));
    expect(limiter.flying).toBe(0);
    resolveFirst(session("迟到"));
  });

  it("shutdown 不会让排队 worker 重新启动", async () => {
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    const first = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(first);
    const manager = new WorkerManager(options({ concurrency: limiter }));
    const accepted = manager.dispatch([
      { title: "运行", task: "任务一", tier: "T1" },
      { title: "排队", task: "任务二", tier: "T1" },
    ]);
    await waitFor(() => expect(manager.get(accepted[0]!.workerId)?.state).toBe("running"));
    expect(manager.get(accepted[1]!.workerId)?.state).toBe("queued");
    manager.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(manager.get(accepted[1]!.workerId)).toMatchObject({ state: "shutdown", cancelReason: "session_shutdown", terminalReason: "session_shutdown" });
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
  });
  it("control 使用 worker 专属队列取代旧指令，并只在离开队列后标为 injected", async () => {
    let listener!: (event: any) => void;
    let steering: string[] = [];
    const activeSession: any = {
      prompt: mock(() => new Promise<void>(() => {})),
      abort: mock().mockResolvedValue(undefined),
      messages: [],
      subscribe: mock((callback: (event: any) => void) => { listener = callback; return () => {}; }),
      steer: mock(async (instruction: string) => {
        steering.push(instruction);
        listener({ type: "queue_update", steering: [...steering], followUp: [] });
      }),
      clearQueue: mock(() => {
        const cleared = { steering: [...steering], followUp: [] };
        steering = [];
        listener({ type: "queue_update", steering: [], followUp: [] });
        return cleared;
      }),
    };
    mockCreateWorkerSession.mockResolvedValue(activeSession);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "最新纠偏优先", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(activeSession.prompt).toHaveBeenCalled());

    const first: any = await manager.control(accepted!.workerId, { action: "steer", instruction: "先检查旧路径" });
    expect(first).toMatchObject({ deliveryState: "queued", commandId: expect.any(String) });
    const second: any = await manager.control(accepted!.workerId, { action: "steer", instruction: "改查新路径" });
    expect(second).toMatchObject({ deliveryState: "queued", commandId: expect.any(String), supersededCommandIds: [first.commandId] });
    expect(activeSession.clearQueue).toHaveBeenCalledTimes(1);
    expect(manager.signalLog.eventsFor(accepted!.workerId)).toContainEqual(expect.objectContaining({ kind: "control_superseded", payload: expect.objectContaining({ commandId: first.commandId }) }));
    expect(manager.get(accepted!.workerId)?.latestControl).toMatchObject({ commandId: second.commandId, action: "steer", deliveryState: "queued" });

    steering = [];
    listener({ type: "queue_update", steering: [], followUp: [] });
    expect(manager.get(accepted!.workerId)?.latestControl).toMatchObject({ commandId: second.commandId, deliveryState: "injected" });
    manager.shutdown();
  });

  it("未注入的 control 会在取消时标为 expired", async () => {
    let listener!: (event: any) => void;
    const activeSession: any = {
      prompt: mock(() => new Promise<void>(() => {})),
      abort: mock().mockResolvedValue(undefined),
      messages: [],
      subscribe: mock((callback: (event: any) => void) => { listener = callback; return () => {}; }),
      steer: mock(async () => listener({ type: "queue_update", steering: ["待发送指令"], followUp: [] })),
    };
    mockCreateWorkerSession.mockResolvedValue(activeSession);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "取消过期控制", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(activeSession.prompt).toHaveBeenCalled());
    const command: any = await manager.control(accepted!.workerId, { action: "steer", instruction: "待发送指令" });
    await manager.control(accepted!.workerId, { action: "cancel", reason: "不再需要" });
    expect(manager.get(accepted!.workerId)?.latestControl).toMatchObject({ commandId: command.commandId, deliveryState: "expired" });
  });

  it("context usage 只读投影，并在 compaction 返回 unknown 时清除旧值", async () => {
    let listener!: (event: any) => void;
    let resolvePrompt!: () => void;
    let usage: any = { tokens: 81_234, contextWindow: 262_144, percent: 31 };
    const activeSession: any = session("完成");
    activeSession.prompt = mock(() => new Promise<void>((resolve) => { resolvePrompt = resolve; }));
    activeSession.subscribe = mock((callback: (event: any) => void) => { listener = callback; return () => {}; });
    activeSession.getContextUsage = mock(() => { if (usage instanceof Error) throw usage; return usage; });
    mockCreateWorkerSession.mockResolvedValue(activeSession);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "上下文", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(listener).toBeTypeOf("function"));
    listener({ type: "message_end", message: { role: "assistant" } });
    expect(manager.get(accepted!.workerId)?.contextUsage).toMatchObject({ tokens: 81_234, contextWindow: 262_144, percent: 31, sampledAt: expect.any(Number) });
    usage = { tokens: null, contextWindow: 262_144, percent: null };
    listener({ type: "compaction_end" });
    expect(manager.get(accepted!.workerId)?.contextUsage).toMatchObject({ tokens: null, contextWindow: 262_144, percent: null });
    usage = new Error("usage unavailable");
    listener({ type: "compaction_end" });
    expect(manager.get(accepted!.workerId)?.contextUsage).toBeUndefined();
    resolvePrompt();
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
  });
});
