import { waitFor } from "./test-helpers.js";
import { mockCreateWorkerSession } from "./mock-modules.js";
import { beforeEach, describe, expect, it , mock } from "bun:test";


import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";
import { workerReport } from "./worker-report.fixture.js";

function options(overrides: any = {}) {
  return {
    cwd: "/workspace", modelRegistry: { find: mock(() => ({ provider: "ctx", id: "model" })) }, model: { provider: "ctx", id: "model" },
    parentActiveTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    concurrency: new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent: mock(), ...overrides,
  };
}

beforeEach(() => mockCreateWorkerSession.mockReset());

describe("next-major worker protocol", () => {
  it("自由文本完成但缺 dteam_report 时失败并释放 session", async () => {
    const session = { prompt: mock().mockResolvedValue(undefined), abort: mock().mockResolvedValue(undefined), dispose: mock(), messages: [{ role: "assistant", content: [{ type: "text", text: "看似完成" }] }] };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "缺报告", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ terminalReason: "missing_report", error: expect.stringContaining("dteam_report") });
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("Manager 报告边界也拒绝旧形状，不能绕过统一 parser", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "旧报告", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    expect(() => manager.receiveReport(accepted!.workerId, { summary: "旧形状", facts: [{ claim: "事实", evidence: "证据" }] })).toThrow("dteam_report");
    manager.cancel(accepted!.workerId);
  });

  it("报告带 worker provenance，handoff 会注入 fresh worker prompt", async () => {
    let prompt = "";
    let workerId = "";
    const events: any[] = [];
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    mockCreateWorkerSession.mockImplementation(async () => {
      return {
        abort: mock().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "完成" }] }],
        prompt: mock(async (input: string) => {
          prompt = input;
          manager.receiveReport(workerId, workerReport({
            summary: "完成",
            facts: [{ claim: "实现存在", evidence: "src/runtime/worker-manager.ts" }],
            verification: { depth: "inspection", status: "passed", evidence: ["DATABASE_URL=postgresql://u:pw@example.test/db"], remaining: ["api_key=sk-remaining-secret-123456789"] },
            uncertainties: ["api_key=sk-uncertain-secret-123456789"],
          }));
        }),
      };
    });
    const [accepted] = manager.dispatch([{ title: "带交接", task: "任务", tier: "T3", handoff: { facts: [{ claim: "前序事实", evidence: "api_key=sk-12345678901234567890", workerId: "previous" }], constraints: ["只读"], uncertainties: ["无"] } }]);
    workerId = accepted!.workerId;
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    await waitFor(() => expect(events.some((event) => event.type === "completed")).toBe(true));
    expect(prompt).toContain("bounded handoff");
    expect(prompt).toContain("前序事实");
    expect(prompt).toContain("[REDACTED_SECRET]");
    expect(prompt).not.toContain("sk-12345678901234567890");
    const report = events.find((event) => event.type === "completed").payload.report;
    expect(report).toMatchObject({ outcome: "completed", activities: ["inspected"], verification: { depth: "inspection", status: "passed" } });
    expect(report.facts[0]).toMatchObject({ claim: "实现存在", workerId: accepted!.workerId });
    expect(report.verification).not.toHaveProperty("workerId");
    expect(JSON.stringify(report)).toContain("[REDACTED_SECRET]");
    expect(JSON.stringify(report)).not.toContain("postgresql://u:pw@example.test/db");
    expect(JSON.stringify(report)).not.toContain("sk-remaining-secret");
    expect(JSON.stringify(report)).not.toContain("sk-uncertain-secret");
  });

  it("writeScope 只约束当前 worker，并在完成事件与压缩 resync 中保留局部边界", async () => {
    let prompt = "";
    let workerId = "";
    const events: any[] = [];
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    mockCreateWorkerSession.mockResolvedValue({
      abort: mock().mockResolvedValue(undefined),
      messages: [{ role: "assistant", content: [{ type: "text", text: "部分完成" }, { type: "toolCall", name: "dteam_report", arguments: workerReport({ outcome: "partial", summary: "仅完成代码切片", facts: [{ claim: "实现已改", evidence: "src/feature.ts:1" }], verification: { depth: "none", status: "not_run", evidence: [], remaining: ["README 未核验"] }, uncertainties: ["发布说明是否需要更新未知"] }) }] }],
      prompt: mock(async (input: string) => { prompt = input; }),
    });
    const [accepted] = manager.dispatch([{ title: "局部实现", task: "只修改代码", tier: "T3", writeScope: ["src/feature.ts"] }]);
    workerId = accepted!.workerId;
    await waitFor(() => expect(manager.get(workerId)?.state).toBe("completed"));
    await waitFor(() => expect(events.some((event) => event.type === "completed")).toBe(true));
    const completed = events.find((event) => event.type === "completed");
    expect(prompt).toContain("只约束当前 worker");
    expect(prompt).toContain("verification.remaining");
    const systemPrompt = mockCreateWorkerSession.mock.calls[0]?.[0]?.systemPrompt;
    expect(systemPrompt).toContain("无剩余验证传 remaining: []");
    expect(systemPrompt).toContain("无不确定性传 uncertainties: []");
    expect(completed.payload.workerBoundary).toEqual({ writeScope: ["src/feature.ts"], localOnly: true });

    manager.markCompactionResync();
    const summary = manager.consumeCompactionResync();
    expect(summary).toContain("<dteam_resync>");
    expect(summary).toContain(workerId);
    expect(summary).toContain("src/feature.ts");
    expect(summary).toContain("README 未核验");
    expect(summary).toContain("发布说明是否需要更新未知");
    expect(manager.consumeCompactionResync()).toBeUndefined();
  });

  it("可写 worker 缺 writeScope 被拒绝，取消后回传 write_interrupted", async () => {
    const manager = new WorkerManager(options());
    expect(() => manager.dispatch([{ title: "缺范围", task: "任务", tier: "T3", addTools: ["edit"] }])).toThrow("writeScope");

    const events: any[] = [];
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const writable = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = writable.dispatch([{ title: "写入", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/runtime/"] }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    writable.cancel(accepted!.workerId);
    expect(events).toContainEqual(expect.objectContaining({ type: "write_interrupted", workerId: accepted!.workerId, payload: expect.objectContaining({ writeScope: ["src/runtime/"], state: "cancelled" }) }));
  });

  it("handoff 拒绝额外字段和超出边界的事实", () => {
    const manager = new WorkerManager(options());
    const fact = { claim: "事实", evidence: "tests/protocol", workerId: "previous" };
    expect(() => manager.dispatch([{ title: "额外交接", task: "任务", tier: "T3", handoff: { facts: [fact], verification: { depth: "inspection" } } as any }])).toThrow("handoff");
    expect(() => manager.dispatch([{ title: "过多事实", task: "任务", tier: "T3", handoff: { facts: Array.from({ length: 25 }, () => fact) } }])).toThrow("handoff.facts");
  });

  it("可写 worker 超时只回传一次中断，recover 只接受 timeout recovery", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const events: any[] = [];
    const manager = new WorkerManager(options({
      timeoutMs: 10,
      onParentEvent: (event: any) => events.push(event),
      onParentEventAvailable: mock(),
    }));
    const [accepted] = manager.dispatch([{ title: "超时", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/runtime/"] }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toBeDefined());
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    const waited = await manager.wait([accepted!.workerId], 10);
    expect(waited.events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "request", workerId: accepted!.workerId }),
      expect.objectContaining({ type: "write_interrupted", workerId: accepted!.workerId, payload: expect.objectContaining({ state: "waiting", writeScope: ["src/runtime/"] }) }),
    ]));
    expect(() => manager.respond(accepted!.workerId, requestId, { type: "deny", reason: "错误工具" })).toThrow("不能回应 timeout_recovery");
    expect(manager.recover(accepted!.workerId, requestId, { action: "stop" })).toMatchObject({ state: "timed_out" });
    manager.flushParentEvents();
    expect(events).toEqual([]);
  });

  it("fresh recovery 必须重新报告，升档时保持报告工具激活", async () => {
    let firstWorkerId = "";
    let secondOptions: any;
    const first = { abort: mock().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "first" }] }], prompt: mock(() => new Promise<void>(() => {})) };
    mockCreateWorkerSession.mockImplementation(async (sessionOptions: any) => {
      if (!firstWorkerId) return first;
      secondOptions = sessionOptions;
      return { abort: mock().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "second" }] }], prompt: mock().mockResolvedValue(undefined) };
    });
    const manager = new WorkerManager(options({ timeoutMs: 10, totalBudgetMs: 50 }));
    const [accepted] = manager.dispatch([{ title: "恢复", task: "任务", tier: "T3" }]);
    firstWorkerId = accepted!.workerId;
    await waitFor(() => expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toBeDefined());
    manager.receiveReport(accepted!.workerId, workerReport({ summary: "first report" }));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "escalate", tier: "T2" });
    await waitFor(() => expect(secondOptions).toBeDefined());
    expect(secondOptions.initialActiveTools).toContain("dteam_report");
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ terminalReason: "missing_report" });
  });
});
