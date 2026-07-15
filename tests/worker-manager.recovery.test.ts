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

  it("进入 timeout recovery 前清理旧的阻塞 request", async () => {
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ timeoutMs: 100, totalBudgetMs: 100 }));
    const [accepted] = manager.dispatch([{ title: "超时等待", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    const oldRequest = manager.receiveSignal(accepted!.workerId, { kind: "request_context", requestId: "old-context", question: "需要上下文" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toBeDefined());
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
});
