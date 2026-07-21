import { waitFor } from "./test-helpers.js";
import { mockCreateWorkerSession } from "./mock-modules.js";
import { beforeEach, describe, expect, it, mock } from "bun:test";
import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";

beforeEach(() => mockCreateWorkerSession.mockReset());

function manager(onParentEvent: (event: any) => void = () => {}, overrides: any = {}) {
  mockCreateWorkerSession.mockResolvedValue({ prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), setActiveToolsByName: mock(), messages: [] });
  return new WorkerManager({
    cwd: "/workspace",
    modelRegistry: { find: mock() },
    model: { provider: "ctx", id: "model" },
    parentActiveTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    concurrency: new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent,
    ...overrides,
  });
}

describe("dteam_respond cancel 响应", () => {
  it("主代理 cancel 直接终止 waiting worker，并清除该 worker 已排队事件", async () => {
    const events: any[] = [];
    const instance = manager((event) => events.push(event), { onParentEventAvailable: mock() });
    const accepted = instance.dispatch([{ title: "接管", task: "task", tier: "T1" }])[0]!;
    const waiting = instance.receiveSignal(accepted.workerId, { kind: "blocked", requestId: "b1", reason: "需要写工具" });
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));

    const result = instance.respond(accepted.workerId, "b1", { type: "cancel", reason: "主代理接管" });
    expect(result).toMatchObject({ workerId: accepted.workerId, requestId: "b1", state: "cancelled" });
    expect(instance.get(accepted.workerId)).toMatchObject({ state: "cancelled", terminalReason: "user_cancelled", cancelReason: "主代理接管" });
    await expect(waiting).resolves.toEqual({ type: "cancel", reason: "主代理接管" });

    instance.flushParentEvents();
    expect(events).toEqual([]);
    const waited = await instance.wait([accepted.workerId], 1);
    expect(waited).toMatchObject({ reason: "timeout", events: [], ready: [expect.objectContaining({ state: "cancelled" })] });
  });

  it("主代理 cancel 同步返回 writeScope 守卫，并清除旧 request 与终态事件", async () => {
    const events: any[] = [];
    const instance = manager((event) => events.push(event), { onParentEventAvailable: mock() });
    const accepted = instance.dispatch([{ title: "可写接管", task: "task", tier: "T1", writeScope: ["src/"] }])[0]!;
    const waiting = instance.receiveSignal(accepted.workerId, { kind: "blocked", requestId: "b1", reason: "主代理接管" });
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));

    const result = instance.respond(accepted.workerId, "b1", { type: "cancel", reason: "主代理接管" });
    expect(result).toMatchObject({ state: "cancelled", writeInterrupted: { reason: "主代理接管", writeScope: ["src/"] } });
    await expect(waiting).resolves.toEqual({ type: "cancel", reason: "主代理接管" });

    instance.flushParentEvents();
    expect(events).toEqual([]);
    const waited = await instance.wait([accepted.workerId], 1);
    expect(waited).toMatchObject({ reason: "timeout", events: [], ready: [expect.objectContaining({ state: "cancelled" })] });
  });

  it("用户取消仍 follow-up cancelled 与 write_interrupted", async () => {
    const events: any[] = [];
    const instance = manager((event) => events.push(event), { onParentEventAvailable: mock() });
    const accepted = instance.dispatch([{ title: "用户取消", task: "task", tier: "T1", writeScope: ["src/"] }])[0]!;
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("running"));

    instance.cancel(accepted.workerId, "用户确认取消");
    instance.flushParentEvents();
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "cancelled", workerId: accepted.workerId, payload: expect.objectContaining({ reason: "用户确认取消" }) }),
      expect.objectContaining({ type: "write_interrupted", workerId: accepted.workerId, payload: expect.objectContaining({ writeScope: ["src/"] }) }),
    ]));
  });

  it("cancel 可回应所有非 timeout_recovery 的 request kind", async () => {
    const cases: Array<{ kind: string; build: () => any }> = [
      { kind: "request_context", build: () => ({ kind: "request_context", requestId: "r", question: "q" }) },
      { kind: "request_tools", build: () => ({ kind: "request_tools", requestId: "r", tools: ["edit"], reason: "need" }) },
      { kind: "request_decision", build: () => ({ kind: "request_decision", requestId: "r", question: "decide" }) },
      { kind: "blocked", build: () => ({ kind: "blocked", requestId: "r", reason: "stuck" }) },
    ];
    for (const { kind, build } of cases) {
      const instance = manager();
      const writable = kind === "request_tools";
      const accepted = instance.dispatch([{ title: kind, task: "task", tier: "T1", ...(writable ? { addTools: ["edit"], writeScope: ["src/"] } : {}) }])[0]!;
      instance.receiveSignal(accepted.workerId, build());
      await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
      expect(() => instance.respond(accepted.workerId, "r", { type: "cancel", reason: "接管" })).not.toThrow();
      expect(instance.get(accepted.workerId)?.state).toBe("cancelled");
      instance.shutdown();
    }
  });

  it("cancel 拒绝回应 timeout_recovery（仍走 dteam_recover 的 stop）", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const instance = new WorkerManager({
      cwd: "/workspace", modelRegistry: { find: mock(() => ({ provider: "ctx", id: "model" })) }, model: { provider: "ctx", id: "model" },
      parentActiveTools: ["read"], concurrency: new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }),
      timeoutMs: 10, onParentEvent: () => {},
    });
    const [accepted] = instance.dispatch([{ title: "超时", task: "task", tier: "T3" }]);
    await waitFor(() => expect(instance.get(accepted!.workerId)?.timeoutDiagnostic).toBeDefined());
    const requestId = instance.get(accepted!.workerId)?.timeoutDiagnostic?.requestId!;
    expect(() => instance.respond(accepted!.workerId, requestId, { type: "cancel", reason: "x" })).toThrow("不能回应 timeout_recovery");
    instance.recover(accepted!.workerId, requestId, { action: "stop" });
    expect(instance.get(accepted!.workerId)?.state).toBe("timed_out");
  });

  it("cancel 回应已终态 worker 报错", async () => {
    const instance = manager();
    const accepted = instance.dispatch([{ title: "终态", task: "task", tier: "T1" }])[0]!;
    instance.receiveSignal(accepted.workerId, { kind: "blocked", requestId: "b1", reason: "x" });
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    instance.respond(accepted.workerId, "b1", { type: "cancel", reason: "停" });
    expect(instance.get(accepted.workerId)?.state).toBe("cancelled");
    expect(() => instance.respond(accepted.workerId, "b1", { type: "cancel", reason: "又停" })).toThrow();
  });
});
