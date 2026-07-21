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
  it("初始 attempt 不超过 totalBudgetMs", async () => {
    const live = session("不应完成");
    live.prompt = mock(() => new Promise<void>(() => {}));
    mockCreateWorkerSession.mockResolvedValue(live);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 5 }));
    const [accepted] = manager.dispatch([{ title: "总预算", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic?.attemptBudgetMs).toBe(5);
    manager.shutdown();
  });

  it("进入 timeout recovery 前清理旧的阻塞 request", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ timeoutMs: 100, totalBudgetMs: 100 }));
    const [accepted] = manager.dispatch([{ title: "超时等待", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    const oldRequest = manager.receiveSignal(accepted!.workerId, { kind: "request_context", requestId: "old-context", question: "需要上下文" });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toBeDefined());
    expect(manager.requestState.list()).toEqual([
      expect.objectContaining({ workerId: accepted!.workerId, kind: "timeout_recovery" }),
    ]);
    manager.shutdown();
    await expect(oldRequest).resolves.toMatchObject({ type: "deny" });
  });

  it("session 创建超时请求恢复且释放槽位", async () => {
    let resolveCreation!: (value: any) => void;
    mockCreateWorkerSession.mockReturnValue(new Promise((resolve) => { resolveCreation = resolve; }));
    const limiter = new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 });
    const manager = new WorkerManager(options({ timeoutMs: 5, concurrency: limiter }));
    const [accepted] = manager.dispatch([{ title: "创建超时", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(limiter.flying).toBe(0);
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "stop" });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    resolveCreation(session("late"));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });

  it("prompt 超时发送带诊断的恢复请求并等待主代理决定", async () => {
    const events: any[] = [];
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200, onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "prompt 超时", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(hanging.abort).toHaveBeenCalled();
    expect(events).toContainEqual(expect.objectContaining({
      type: "request",
      workerId: accepted!.workerId,
      payload: expect.objectContaining({ kind: "timeout_recovery", elapsedMs: expect.any(Number), totalBudgetMs: 50, attemptBudgetMs: 50, maxRecoveryBudgetMs: 600_000, currentTool: "无", outputSummary: "暂无输出", lastActivity: expect.any(String) }),
    }));
    manager.shutdown();
  });

  it("wait 已消费 timeout request 后，主代理 stop 不再回放冗余终态", async () => {
    const events: any[] = [];
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({
      timeoutMs: 10,
      totalBudgetMs: 10,
      onParentEvent: (event: any) => events.push(event),
      onParentEventAvailable: mock(),
    }));
    const [accepted] = manager.dispatch([{ title: "已处理超时", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));

    const waited = await manager.wait([accepted!.workerId], 10);
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    expect(waited.events).toEqual([expect.objectContaining({ type: "request", workerId: accepted!.workerId })]);

    expect(manager.recover(accepted!.workerId, requestId, { action: "stop", reason: "不再需要" })).toMatchObject({ state: "timed_out" });
    expect(manager.get(accepted!.workerId)?.state).toBe("timed_out");
    manager.flushParentEvents();
    expect(events).toEqual([]);
  });

  it("主代理 stop 同步返回 writeScope 守卫，并清除已排队 timeout 事件", async () => {
    const events: any[] = [];
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({
      timeoutMs: 10,
      totalBudgetMs: 10,
      onParentEvent: (event: any) => events.push(event),
      onParentEventAvailable: mock(),
    }));
    const [accepted] = manager.dispatch([{ title: "显式停止", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/"] }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;

    const result = manager.recover(accepted!.workerId, requestId, { action: "stop", reason: "主代理接管" });
    expect(result).toMatchObject({
      state: "timed_out",
      writeInterrupted: { reason: "主代理接管", writeScope: ["src/"] },
    });
    manager.flushParentEvents();
    expect(events).toEqual([]);
    const waited = await manager.wait([accepted!.workerId], 1);
    expect(waited).toMatchObject({ reason: "timeout", events: [], ready: [expect.objectContaining({ state: "timed_out" })] });
  });

  it("abort 让 prompt resolve 时仍请求 timeout recovery，不误报无 assistant 文本", async () => {
    let resolvePrompt!: () => void;
    const session = {
      prompt: mock(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })),
      abort: mock(() => { resolvePrompt(); return Promise.resolve(); }),
      messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "超时竞态", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const diagnostic = manager.get(accepted!.workerId)?.timeoutDiagnostic!;
    expect(diagnostic.lastActivity).not.toContain("assistant 文本");
    manager.recover(accepted!.workerId, diagnostic.requestId, { action: "stop" });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
  });

  it("recovery prompt 会脱敏 worker 输出中的常见密钥", async () => {
    const first = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "api_key=sk-12345678901234567890 password=hunter2 DATABASE_URL=postgresql://alice:pw123@db.internal/app https://alice:pw123@example.test/api" }] }] };
    const second = session("已脱敏完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 10, totalBudgetMs: 20 }));
    const [accepted] = manager.dispatch([{ title: "脱敏", task: "读取 api_key=sk-12345678901234567890 DATABASE_URL=postgresql://alice:pw123@db.internal/app https://alice:pw123@example.test/api", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic?.outputSummary).toContain("[REDACTED_SECRET]");
    manager.recover(accepted!.workerId, requestId, { action: "retry" });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
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
    const first = { prompt: mock(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })), abort: mock(() => { resolvePrompt(); return Promise.resolve(); }), messages: [] };
    const second = session("重试完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const events: any[] = [];
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200, onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "重试", task: "原始任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "retry" });
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(second.prompt).toHaveBeenCalled();
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(2);
    expect(second.prompt).toHaveBeenCalledWith(expect.stringContaining("timeout recovery context"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T3", fallbackTrail: ["T3"], result: "重试完成" });
  });

  it("主代理只能相邻升级 T3→T2", async () => {
    let resolvePrompt!: () => void;
    const first = { prompt: mock(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })), abort: mock(() => { resolvePrompt(); return Promise.resolve(); }), messages: [] };
    const second = session("T2 完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "升级", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "escalate", tier: "T2" });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(mockCreateWorkerSession).toHaveBeenLastCalledWith(expect.objectContaining({ tier: "T2" }));
    expect(manager.get(accepted!.workerId)).toMatchObject({ activeTier: "T2", fallbackTrail: ["T3", "T2"] });
  });

  it("创建 session 和 prompt 共用同一累计预算", async () => {
    const delayedSession = session("不应完成");
    delayedSession.prompt = mock(() => new Promise<void>(() => {}));
    mockCreateWorkerSession.mockImplementationOnce(() => new Promise((resolve) => setTimeout(() => resolve(delayedSession), 6)));
    const manager = new WorkerManager(options({ timeoutMs: 10, totalBudgetMs: 10 }));
    const [accepted] = manager.dispatch([{ title: "共享预算", task: "任务", tier: "T1" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toMatchObject({ totalBudgetMs: 10, elapsedMs: expect.any(Number) });
    manager.shutdown();
  });

  it("extend 在预算上限内延长当前档位预算", async () => {
    let resolvePrompt!: () => void;
    const first = { prompt: mock(() => new Promise<void>((resolve) => { resolvePrompt = resolve; })), abort: mock(() => { resolvePrompt(); return Promise.resolve(); }), messages: [] };
    const second = session("延长完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "延长", task: "任务", tier: "T2" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "extend", additionalMs: 10 });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(mockCreateWorkerSession).toHaveBeenLastCalledWith(expect.objectContaining({ tier: "T2" }));
    expect(second.prompt).toHaveBeenCalledWith(expect.stringContaining("timeout recovery context"));
  });

  it("extend 超过总预算上限时 fail-closed", async () => {
    const first = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(first);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "超额延长", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "extend", additionalMs: DTEAM_CONFIG.dispatch.maxRecoveryBudgetMs + 1 });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(manager.get(accepted!.workerId)?.error).toContain("超过总上限");
  });

  it("首次 attempt 耗尽后 recovery 仍可使用独立预算", async () => {
    const first = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    const second = session("recovery 完成");
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 50 }));
    const [accepted] = manager.dispatch([{ title: "独立 recovery", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toMatchObject({ totalBudgetMs: 50, maxRecoveryBudgetMs: 600_000 });
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "retry" });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    expect(second.prompt).toHaveBeenCalledWith(expect.stringContaining("timeout recovery context"));
  });

  it("拒绝非相邻跨档升级 T3→T1", async () => {
    const first = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(first);
    const manager = new WorkerManager(options({ timeoutMs: 5, totalBudgetMs: 100 }));
    const [accepted] = manager.dispatch([{ title: "跳档", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "escalate", tier: "T1" });
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(manager.get(accepted!.workerId)?.error).toContain("不允许从 T3 升级到 T1");
  });

  it("超过恢复次数上限后请求被拒绝并进入 timed_out", async () => {
    const hanging = () => ({ prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] });
    mockCreateWorkerSession.mockResolvedValue(hanging());
    const manager = new WorkerManager(options({ timeoutMs: 50, totalBudgetMs: 200 }));
    const [accepted] = manager.dispatch([{ title: "上限", task: "任务", tier: "T3" }]);
    for (let i = 0; i <= DTEAM_CONFIG.dispatch.maxTimeoutRecoveries; i++) {
      await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("waiting"));
      const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
      if (i < DTEAM_CONFIG.dispatch.maxTimeoutRecoveries) {
        manager.recover(accepted!.workerId, requestId, { action: "retry" });
        await new Promise((resolve) => setTimeout(resolve, 0));
      } else {
        manager.recover(accepted!.workerId, requestId, { action: "retry" });
      }
    }
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(manager.get(accepted!.workerId)?.terminalReason).toBe("timeout");
  });
});
