import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkerSession } = vi.hoisted(() => ({ mockCreateWorkerSession: vi.fn() }));
vi.mock("../src/session.js", () => ({ createWorkerSession: mockCreateWorkerSession }));

import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { DTEAM_CONFIG } from "../src/config.js";
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

  it("初始 attempt 不超过 totalBudgetMs", async () => {
    const live = session("不应完成");
    live.prompt = vi.fn(() => new Promise<void>(() => {}));
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 5 }));
    const [accepted] = manager.dispatch([{ title: "总预算", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic?.attemptBudgetMs).toBe(5);
    manager.shutdown();
  });

  it("dteam_signal 不消耗工作工具额度，超额工作工具会终止 worker", async () => {
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
    listener({ type: "tool_execution_start", toolName: "read" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)?.error).toContain("工具调用额度");
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

  it("无 assistant 文本不会自动跨档到 T1", async () => {
    const noText = { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(noText).mockResolvedValueOnce(session("不应执行"));
    const manager = new WorkerManager(options({ tierModelRoutes: { T3: { primary: "ctx/model" }, T1: { primary: "ctx/model" } } }));
    const [accepted] = manager.dispatch([{ title: "无文本失败", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T3", fallbackTrail: ["T3"], error: expect.stringContaining("assistant 文本") });
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
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

  it("session 创建超时请求恢复且释放槽位", async () => {
    let resolveCreation!: (value: any) => void;
    mockCreateWorkerSession.mockReturnValue(new Promise((resolve) => { resolveCreation = resolve; }));
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    const manager = new WorkerManager(options({ timeoutMs: 5, concurrency: limiter }));
    const [accepted] = manager.dispatch([{ title: "创建超时", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(limiter.flying).toBe(0);
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.respond(accepted!.workerId, requestId, { type: "stop" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    resolveCreation(session("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("prompt 超时发送带诊断的恢复请求并等待主代理决定", async () => {
    const events: any[] = [];
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200, onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "prompt 超时", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(hanging.abort).toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: "request",
      workerId: accepted!.workerId,
      payload: expect.objectContaining({ kind: "timeout_recovery", elapsedMs: expect.any(Number), totalBudgetMs: 50, attemptBudgetMs: 50, maxRecoveryBudgetMs: 600_000, currentTool: "无", outputSummary: "暂无输出", lastActivity: expect.any(String) }),
    }));
    manager.shutdown();
  });

  it("abort 让 prompt resolve 时仍请求 timeout recovery，不误报无 assistant 文本", async () => {
    let resolvePrompt!: () => void;
    const session = {
      prompt: vi.fn(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })),
      abort: vi.fn(() => { resolvePrompt(); return Promise.resolve(); }),
      messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "超时竞态", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const diagnostic = manager.get(accepted!.workerId)?.timeoutDiagnostic!;
    expect(diagnostic.lastActivity).not.toContain("assistant 文本");
    manager.respond(accepted!.workerId, diagnostic.requestId, { type: "stop" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
  });

  it("recovery prompt 会脱敏 worker 输出中的常见密钥", async () => {
    const first = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "api_key=sk-12345678901234567890 password=hunter2 DATABASE_URL=postgresql://alice:pw123@db.internal/app https://alice:pw123@example.test/api" }] }] };
    const second = session("已脱敏完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 10, totalBudgetMs: 20 }));
    const [accepted] = manager.dispatch([{ title: "脱敏", task: "读取 api_key=sk-12345678901234567890 DATABASE_URL=postgresql://alice:pw123@db.internal/app https://alice:pw123@example.test/api", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic?.outputSummary).toContain("[REDACTED_SECRET]");
    manager.respond(accepted!.workerId, requestId, { type: "retry" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    const prompt = second.prompt.mock.calls[0]?.[0] as string;
    expect(prompt).toContain("[REDACTED_SECRET]");
    expect(prompt).not.toContain("sk-12345678901234567890");
    expect(prompt).not.toContain("hunter2");
    expect(prompt).not.toContain("pw123");
    expect(prompt).not.toContain("https://alice:pw123@example.test/api");
    expect(prompt).toContain("DATABASE_URL=[REDACTED_SECRET]");
    expect(prompt).toContain("https://alice:[REDACTED_SECRET]@example.test/api");
  });

  it("主代理 retry 会创建同档 fresh session 并注入裁剪恢复摘要", async () => {
    let resolvePrompt!: () => void;
    const first = { prompt: vi.fn(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })), abort: vi.fn(() => { resolvePrompt(); return Promise.resolve(); }), messages: [] };
    const second = session("重试完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const events: any[] = [];
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200, onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "重试", task: "原始任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.respond(accepted!.workerId, requestId, { type: "retry" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(second.prompt).toHaveBeenCalled();
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(2);
    expect(second.prompt).toHaveBeenCalledWith(expect.stringContaining("timeout recovery context"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T3", fallbackTrail: ["T3"], result: "重试完成" });
  });

  it("主代理只能相邻升级 T3→T2", async () => {
    let resolvePrompt!: () => void;
    const first = { prompt: vi.fn(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })), abort: vi.fn(() => { resolvePrompt(); return Promise.resolve(); }), messages: [] };
    const second = session("T2 完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "升级", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.respond(accepted!.workerId, requestId, { type: "escalate", tier: "T2" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(mockCreateWorkerSession).toHaveBeenLastCalledWith(expect.objectContaining({ tier: "T2" }));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T2", fallbackTrail: ["T3", "T2"] });
  });

  it("创建 session 和 prompt 共用同一累计预算", async () => {
    const delayedSession = session("不应完成");
    delayedSession.prompt = vi.fn(() => new Promise<void>(() => {}));
    mockCreateWorkerSession.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(delayedSession), 6)));
    const manager = new WorkerManager(options({ timeoutMs: 10, totalBudgetMs: 10 }));
    const [accepted] = manager.dispatch([{ title: "共享预算", task: "任务", tier: "T1" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toMatchObject({ totalBudgetMs: 10, elapsedMs: expect.any(Number) });
    manager.shutdown();
  });

  it("extend 在预算上限内延长当前档位预算", async () => {
    let resolvePrompt!: () => void;
    const first = { prompt: vi.fn(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })), abort: vi.fn(() => { resolvePrompt(); return Promise.resolve(); }), messages: [] };
    const second = session("延长完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "延长", task: "任务", tier: "T2" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.respond(accepted!.workerId, requestId, { type: "extend", additionalMs: 10 });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(mockCreateWorkerSession).toHaveBeenLastCalledWith(expect.objectContaining({ tier: "T2" }));
    expect(second.prompt).toHaveBeenCalledWith(expect.stringContaining("timeout recovery context"));
  });

  it("extend 超过总预算上限时 fail-closed", async () => {
    const first = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(first);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "超额延长", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.respond(accepted!.workerId, requestId, { type: "extend", additionalMs: DTEAM_CONFIG.dispatch.maxRecoveryBudgetMs + 1 });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(manager.get(accepted!.workerId)?.error).toContain("超过总上限");
  });

  it("首次 attempt 耗尽后 recovery 仍可使用独立预算", async () => {
    const first = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    const second = session("recovery 完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 50 }));
    const [accepted] = manager.dispatch([{ title: "独立 recovery", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toMatchObject({ totalBudgetMs: 50, maxRecoveryBudgetMs: 600_000 });
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.respond(accepted!.workerId, requestId, { type: "retry" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(second.prompt).toHaveBeenCalledWith(expect.stringContaining("timeout recovery context"));
  });

  it("拒绝非相邻跨档升级 T3→T1", async () => {
    const first = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(first);
    const manager = new WorkerManager(options({ timeoutMs: 5, totalBudgetMs: 100 }));
    const [accepted] = manager.dispatch([{ title: "跳档", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.respond(accepted!.workerId, requestId, { type: "escalate", tier: "T1" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(manager.get(accepted!.workerId)?.error).toContain("不允许从 T3 升级到 T1");
  });

  it("超过恢复次数上限后请求被拒绝并进入 timed_out", async () => {
    const hanging = () => ({ prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] });
    mockCreateWorkerSession.mockResolvedValue(hanging());
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "上限", task: "任务", tier: "T3" }]);
    for (let i = 0; i <= DTEAM_CONFIG.dispatch.maxTimeoutRecoveries; i++) {
      await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
      const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
      if (i < DTEAM_CONFIG.dispatch.maxTimeoutRecoveries) {
        manager.respond(accepted!.workerId, requestId, { type: "retry" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      } else {
        manager.respond(accepted!.workerId, requestId, { type: "retry" });
      }
    }
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(manager.get(accepted!.workerId)?.terminalReason).toBe("timeout");
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
    expect(manager.get(accepted!.workerId)?.state).toBe("shutdown");
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
