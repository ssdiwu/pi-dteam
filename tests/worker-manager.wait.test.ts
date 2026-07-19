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
    concurrency: new AdaptiveConcurrency({ min: 1, max: 2, initial: 2, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent: mock(), timeoutMs: 1_000, ...overrides,
  };
}

beforeEach(() => mockCreateWorkerSession.mockReset());

describe("WorkerManager explicit dependency wait", () => {
  it("目标 worker 终态时解除 wait，并消费同一 parent event", async () => {
    const events: any[] = [];
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "等待取消", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    const waiting = manager.wait([accepted!.workerId], 100);
    manager.cancel(accepted!.workerId);
    await expect(waiting).resolves.toMatchObject({ reason: "worker_event", ready: [expect.objectContaining({ id: accepted!.workerId, state: "cancelled" })], pendingWorkerIds: [] });
    expect(events.some((event) => event.type === "cancelled" && event.workerId === accepted!.workerId)).toBe(false);
  });

  it("同一事件只解除一个重叠 wait", async () => {
    const events: any[] = [];
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "单消费者", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    const first = manager.wait([accepted!.workerId], 100);
    const second = manager.wait([accepted!.workerId], 20);
    manager.cancel(accepted!.workerId);

    await expect(first).resolves.toMatchObject({ reason: "worker_event", events: [expect.objectContaining({ type: "cancelled" })] });
    await expect(second).resolves.toMatchObject({ reason: "timeout", events: [] });
    expect(events).toEqual([]);
  });

  it("任一 worker 需要主代理回应时解除多 worker wait，并带 request", async () => {
    const events: any[] = [];
    const first = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    const second = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const accepted = manager.dispatch([{ title: "一", task: "任务", tier: "T3" }, { title: "二", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(first.prompt).toHaveBeenCalled());
    const waiting = manager.wait(accepted.map((item) => item.workerId), 100);
    const request = manager.receiveSignal(accepted[0]!.workerId, { kind: "request_context", requestId: "ctx", question: "需要上下文" });
    await expect(waiting).resolves.toMatchObject({ reason: "worker_event", ready: [expect.objectContaining({ id: accepted[0]!.workerId, state: "waiting" })], requests: [expect.objectContaining({ workerId: accepted[0]!.workerId, requestId: "ctx", kind: "request_context" })], pendingWorkerIds: [accepted[1]!.workerId] });
    expect(events.some((event) => event.type === "request" && event.workerId === accepted[0]!.workerId)).toBe(false);
    manager.respond(accepted[0]!.workerId, "ctx", { type: "provide_context", context: "ok" });
    await request;
    manager.shutdown();
  });

  it("完成后才调用 wait 仍会消费待回放事件", async () => {
    let finish!: () => void;
    const events: any[] = [];
    const session = {
      prompt: mock(() => new Promise<void>((resolve) => { finish = resolve; })),
      abort: mock().mockResolvedValue(undefined),
      messages: [{ role: "assistant", content: [
        { type: "text", text: "完成" },
        { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: "完成" }) },
      ] }],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options({
      onParentEvent: (event: any) => events.push(event),
      onParentEventAvailable: mock(),
    }));
    const [accepted] = manager.dispatch([{ title: "迟到等待", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(session.prompt).toHaveBeenCalled());
    finish();
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));

    await expect(manager.wait([accepted!.workerId], 100)).resolves.toMatchObject({
      reason: "worker_event",
      events: [expect.objectContaining({ type: "completed", workerId: accepted!.workerId })],
      ready: [expect.objectContaining({ id: accepted!.workerId, state: "completed" })],
    });
    await expect(manager.wait([accepted!.workerId], 10)).resolves.toMatchObject({ reason: "timeout", events: [] });
    manager.flushParentEvents();
    expect(events).toEqual([]);
  });

  it("无输出只读失败仅供迟到 wait 消费，不触发回放", async () => {
    const events: any[] = [];
    const onParentEventAvailable = mock();
    const session = {
      prompt: mock().mockResolvedValue(undefined),
      abort: mock().mockResolvedValue(undefined),
      messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options({
      onParentEvent: (event: any) => events.push(event),
      onParentEventAvailable,
    }));
    const [accepted] = manager.dispatch([{ title: "无输出只读", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));

    expect(onParentEventAvailable).not.toHaveBeenCalled();
    manager.flushParentEvents();
    expect(events).toEqual([]);
    await expect(manager.wait([accepted!.workerId], 100)).resolves.toMatchObject({
      reason: "worker_event",
      events: [expect.objectContaining({ type: "failed", workerId: accepted!.workerId })],
      ready: [expect.objectContaining({ id: accepted!.workerId, state: "failed" })],
    });
  });

  it("未被 wait 消费的完成事件只 flush 一次", async () => {
    const events: any[] = [];
    const session = {
      prompt: mock().mockResolvedValue(undefined),
      abort: mock().mockResolvedValue(undefined),
      messages: [{ role: "assistant", content: [
        { type: "text", text: "完成" },
        { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: "完成" }) },
      ] }],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options({
      onParentEvent: (event: any) => events.push(event),
      onParentEventAvailable: mock(),
    }));
    const [accepted] = manager.dispatch([{ title: "后台回放", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("completed"));

    manager.flushParentEvents();
    manager.flushParentEvents();
    expect(events).toEqual([expect.objectContaining({ type: "completed", workerId: accepted!.workerId })]);
    await expect(manager.wait([accepted!.workerId], 10)).resolves.toMatchObject({ reason: "timeout", events: [] });
  });

  it("迟到 wait 会显式返回 write_interrupted 事件", async () => {
    const failed = {
      prompt: mock().mockRejectedValue(new Error("write failed")),
      abort: mock().mockResolvedValue(undefined),
      messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(failed);
    const manager = new WorkerManager(options({ onParentEventAvailable: mock() }));
    const [accepted] = manager.dispatch([{ title: "写入中断", task: "任务", tier: "T3", addTools: ["edit"], writeScope: ["src/runtime/"] }]);
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));

    await expect(manager.wait([accepted!.workerId], 100)).resolves.toMatchObject({
      reason: "worker_event",
      events: [
        expect.objectContaining({ type: "failed", workerId: accepted!.workerId }),
        expect.objectContaining({ type: "write_interrupted", workerId: accepted!.workerId, payload: expect.objectContaining({ writeScope: ["src/runtime/"] }) }),
      ],
    });
  });

  it("wait timeout 仅返回部分状态，不取消后台 worker", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "超时等待", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    await expect(manager.wait([accepted!.workerId], 10)).resolves.toMatchObject({ reason: "timeout", ready: [], pendingWorkerIds: [accepted!.workerId] });
    expect(manager.get(accepted!.workerId)?.state).toBe("running");
    manager.shutdown();
  });

  it("非超时失败会清理旧 pending request，wait 不返回僵尸请求", async () => {
    let rejectPrompt!: (error: Error) => void;
    const session = {
      prompt: mock(() => new Promise<void>((_resolve, reject) => { rejectPrompt = reject; })),
      abort: mock().mockResolvedValue(undefined), messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "失败时清理请求", task: "任务", tier: "T3" }]);
    await waitFor(() => expect(session.prompt).toHaveBeenCalled());
    const request = manager.receiveSignal(accepted!.workerId, { kind: "request_context", requestId: "ctx", question: "需要上下文" });
    rejectPrompt(new Error("provider disconnected"));
    await waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    await expect(request).resolves.toMatchObject({ type: "deny" });
    await expect(manager.wait([accepted!.workerId], 100)).resolves.toMatchObject({ ready: [expect.objectContaining({ id: accepted!.workerId, state: "failed" })], requests: [] });
    manager.shutdown();
  });
});
