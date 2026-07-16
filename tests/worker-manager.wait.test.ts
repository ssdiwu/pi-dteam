import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockCreateWorkerSession } = vi.hoisted(() => ({ mockCreateWorkerSession: vi.fn() }));
vi.mock("../src/session.js", () => ({ createWorkerSession: mockCreateWorkerSession }));

import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";

function options(overrides: any = {}) {
  return {
    cwd: "/workspace", modelRegistry: { find: vi.fn(() => ({ provider: "ctx", id: "model" })) }, model: { provider: "ctx", id: "model" },
    parentActiveTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    concurrency: new AdaptiveConcurrency({ min: 1, max: 2, initial: 2, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent: vi.fn(), timeoutMs: 1_000, ...overrides,
  };
}

beforeEach(() => mockCreateWorkerSession.mockReset());

describe("WorkerManager explicit dependency wait", () => {
  it("目标 worker 终态时解除 wait，并消费同一 parent event", async () => {
    const events: any[] = [];
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const [accepted] = manager.dispatch([{ title: "等待取消", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    const waiting = manager.wait([accepted!.workerId], 100);
    manager.cancel(accepted!.workerId);
    await expect(waiting).resolves.toMatchObject({ reason: "worker_event", ready: [expect.objectContaining({ id: accepted!.workerId, state: "cancelled" })], pendingWorkerIds: [] });
    expect(events.some((event) => event.type === "cancelled" && event.workerId === accepted!.workerId)).toBe(false);
  });

  it("任一 worker 需要主代理回应时解除多 worker wait，并带 request", async () => {
    const events: any[] = [];
    const first = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    const second = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const manager = new WorkerManager(options({ onParentEvent: (event: any) => events.push(event) }));
    const accepted = manager.dispatch([{ title: "一", task: "任务", tier: "T3" }, { title: "二", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(first.prompt).toHaveBeenCalled());
    const waiting = manager.wait(accepted.map((item) => item.workerId), 100);
    const request = manager.receiveSignal(accepted[0]!.workerId, { kind: "request_context", requestId: "ctx", question: "需要上下文" });
    await expect(waiting).resolves.toMatchObject({ reason: "worker_event", ready: [expect.objectContaining({ id: accepted[0]!.workerId, state: "waiting" })], requests: [expect.objectContaining({ workerId: accepted[0]!.workerId, requestId: "ctx", kind: "request_context" })], pendingWorkerIds: [accepted[1]!.workerId] });
    expect(events.some((event) => event.type === "request" && event.workerId === accepted[0]!.workerId)).toBe(false);
    manager.respond(accepted[0]!.workerId, "ctx", { type: "provide_context", context: "ok" });
    await request;
    manager.shutdown();
  });

  it("wait timeout 仅返回部分状态，不取消后台 worker", async () => {
    const hanging = { prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "超时等待", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    await expect(manager.wait([accepted!.workerId], 10)).resolves.toMatchObject({ reason: "timeout", ready: [], pendingWorkerIds: [accepted!.workerId] });
    expect(manager.get(accepted!.workerId)?.state).toBe("running");
    manager.shutdown();
  });

  it("非超时失败会清理旧 pending request，wait 不返回僵尸请求", async () => {
    let rejectPrompt!: (error: Error) => void;
    const session = {
      prompt: vi.fn(() => new Promise<void>((_resolve, reject) => { rejectPrompt = reject; })),
      abort: vi.fn().mockResolvedValue(undefined), messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const manager = new WorkerManager(options());
    const [accepted] = manager.dispatch([{ title: "失败时清理请求", task: "任务", tier: "T3" }]);
    await vi.waitFor(() => expect(session.prompt).toHaveBeenCalled());
    const request = manager.receiveSignal(accepted!.workerId, { kind: "request_context", requestId: "ctx", question: "需要上下文" });
    rejectPrompt(new Error("provider disconnected"));
    await vi.waitFor(() => expect(manager.get(accepted!.workerId)?.state).toBe("failed"));
    await expect(request).resolves.toMatchObject({ type: "deny" });
    await expect(manager.wait([accepted!.workerId], 100)).resolves.toMatchObject({ ready: [expect.objectContaining({ id: accepted!.workerId, state: "failed" })], requests: [] });
    manager.shutdown();
  });
});
