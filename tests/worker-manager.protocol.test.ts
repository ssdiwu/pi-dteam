import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkerSession } = vi.hoisted(() => ({ mockCreateWorkerSession: vi.fn() }));
vi.mock("../src/session.js", () => ({ createWorkerSession: mockCreateWorkerSession }));

import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";
import { workerReport } from "./worker-report.fixture.js";

function options(overrides: any = {}) {
  return {
    cwd: "/workspace", modelRegistry: { find: vi.fn(() => ({ provider: "ctx", id: "model" })) }, model: { provider: "ctx", id: "model" },
    parentActiveTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    concurrency: new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent: vi.fn(), ...overrides,
  };
}

beforeEach(() => mockCreateWorkerSession.mockReset());

describe("next-major worker protocol", () => {
  it("自由文本完成但缺 dteam_report 时失败并释放 session", async () => {
    const session = { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined), dispose: vi.fn(), messages: [{ role: "assistant", content: [{ type: "text", text: "看似完成" }] }] };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "缺报告", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ terminalReason: "missing_report", error: expect.stringContaining("dteam_report") });
    expect(session.dispose).toHaveBeenCalledTimes(1);
  });

  it("Manager 报告边界也拒绝旧形状，不能绕过统一 parser", async () => {
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "旧报告", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
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
        abort: vi.fn().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "完成" }] }],
        prompt: vi.fn(async (input: string) => {
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
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));
    await vi.waitFor(() => expect(events.some((event) => event.type === "completed")).toBe(true));
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

  it("可写 worker 缺 writeScope 被拒绝，取消后回传 write_interrupted", async () => {
    const manager = new WorkerManager(options());
    expect(() => manager.dispatch([{ title: "缺范围", task: "任务", tier: "T3", addTools: ["edit"] }])).toThrow("writeScope");

    const events: any[] = [];
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const writable = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = writable.dispatch([{ title: "写入", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/runtime/"] }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    writable.cancel(accepted!.workerId);
    expect(events).toContainEqual(expect.objectContaining({ type: "write_interrupted", workerId: accepted!.workerId, payload: expect.objectContaining({ writeScope: ["src/runtime/"], state: "cancelled" }) }));
  });

  it("handoff 拒绝额外字段和超出边界的事实", () => {
    const manager = new WorkerManager(options());
    const fact = { claim: "事实", evidence: "tests/protocol", workerId: "previous" };
    expect(() => manager.dispatch([{ title: "额外交接", task: "任务", tier: "T3", handoff: { facts: [fact], verification: { depth: "inspection" } } as any }])).toThrow("handoff");
    expect(() => manager.dispatch([{ title: "过多事实", task: "任务", tier: "T3", handoff: { facts: Array.from({ length: 25 }, () => fact) } }])).toThrow("handoff.facts");
  });

  it("可写 worker 超时立即回传中断，recover 只接受 timeout recovery", async () => {
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const events: any[] = [];
    const manager = new WorkerManager(options({ timeoutMs: 10, onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "超时", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/runtime/"] }]);
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toBeDefined());
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    expect(events).toContainEqual(expect.objectContaining({ type: "write_interrupted", workerId: accepted!.workerId, payload: expect.objectContaining({ state: "waiting", writeScope: ["src/runtime/"] }) }));
    expect(() => manager.respond(accepted!.workerId, requestId, { type: "deny", reason: "错误工具" })).toThrow("不能回应 timeout_recovery");
    manager.recover(accepted!.workerId, requestId, { action: "stop" });
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("timed_out"));
    expect(events).toContainEqual(expect.objectContaining({ type: "write_interrupted", workerId: accepted!.workerId, payload: expect.objectContaining({ state: "timed_out", writeScope: ["src/runtime/"] }) }));
  });

  it("fresh recovery 必须重新报告，升档时保持报告工具激活", async () => {
    let firstWorkerId = "";
    let secondOptions: any;
    const first = { abort: vi.fn().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "first" }] }], prompt: vi.fn(() => new Promise<void>(() => {})) };
    mockCreateWorkerSession.mockImplementation(async (sessionOptions: any) => {
      if (!firstWorkerId) return first;
      secondOptions = sessionOptions;
      return { abort: vi.fn().mockResolvedValue(undefined), messages: [{ role: "assistant", content: [{ type: "text", text: "second" }] }], prompt: vi.fn().mockResolvedValue(undefined) };
    });
    const manager = new WorkerManager(options({ timeoutMs: 10, totalBudgetMs: 50 }));
    const [accepted] = manager.dispatch([{ title: "恢复", task: "任务", tier: "T3" }]);
    firstWorkerId = accepted!.workerId;
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.timeoutDiagnostic).toBeDefined());
    manager.receiveReport(accepted!.workerId, workerReport({ summary: "first report" }));
    const requestId = manager.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    manager.recover(accepted!.workerId, requestId, { action: "escalate", tier: "T2" });
    await vi.waitFor(() => expect(secondOptions).toBeDefined());
    expect(secondOptions.initialActiveTools).toContain("dteam_report");
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    expect(manager.get(accepted!.workerId)).toMatchObject({ terminalReason: "missing_report" });
  });
});
