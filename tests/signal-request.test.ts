import { beforeEach, describe, expect, it, vi } from "vitest";
const { mockCreateWorkerSession } = vi.hoisted(() => ({ mockCreateWorkerSession: vi.fn() }));
vi.mock("../src/session.js", () => ({ createWorkerSession: mockCreateWorkerSession }));
import { RequestState } from "../src/runtime/request-state.js";
import { SignalLog } from "../src/runtime/signal-log.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";
import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";

beforeEach(() => mockCreateWorkerSession.mockReset());

function manager(onParentEvent: (event: any) => void = () => {}) {
  mockCreateWorkerSession.mockResolvedValue({ prompt: vi.fn(() => new Promise<void>(() => {})), abort: vi.fn().mockResolvedValue(undefined), setActiveToolsByName: vi.fn(), messages: [] });
  return new WorkerManager({
    cwd: "/workspace",
    modelRegistry: { find: vi.fn() },
    model: { provider: "ctx", id: "model" },
    parentActiveTools: ["read", "grep", "find", "ls", "bash", "edit", "write"],
    concurrency: new AdaptiveConcurrency({ min: 1, max: 1, initial: 1, cooldownMs: 1000, successStreakToRise: 99 }),
    onParentEvent,
  });
}

describe("SignalLog and RequestState", () => {
  it("只追加 signal，并投影最新 snapshot", () => {
    const log = new SignalLog();
    log.setSnapshot({ id: "w", title: "t", task: "x", requestedTier: "T3", activeTier: "T3", fallbackTrail: [], state: "running", activeTools: ["read"] });
    log.append({ signalId: "s", workerId: "w", at: 1, kind: "progress", payload: { message: "half" } });
    log.updateSnapshot("w", { latestFinding: "found" });
    expect(log.eventsFor("w")).toHaveLength(1);
    expect(log.snapshot("w")).toMatchObject({ state: "running", latestFinding: "found" });
  });

  it("RequestState 只接受匹配 worker 的一次回应", async () => {
    const state = new RequestState();
    const pending = state.wait({ workerId: "w", requestId: "r", kind: "request_context", payload: {} });
    expect(() => state.respond("other", "r", { type: "deny", reason: "no" })).toThrow();
    state.respond("w", "r", { type: "provide_context", context: "ctx" });
    await expect(pending).resolves.toEqual({ type: "provide_context", context: "ctx" });
    expect(() => state.respond("w", "r", { type: "deny", reason: "late" })).toThrow();
    const first = state.wait({ workerId: "w1", requestId: "same", kind: "blocked", payload: {} });
    const second = state.wait({ workerId: "w2", requestId: "same", kind: "blocked", payload: {} });
    state.respond("w1", "same", { type: "deny", reason: "one" });
    state.respond("w2", "same", { type: "deny", reason: "two" });
    await expect(first).resolves.toEqual({ type: "deny", reason: "one" });
    await expect(second).resolves.toEqual({ type: "deny", reason: "two" });
  });
});

describe("worker signal protocol", () => {
  it("progress/finding 不打断主代理，阻塞 request 可由 respond 恢复", async () => {
    const events: any[] = [];
    const managerInstance = manager((event) => { events.push(event); });
    const accepted = managerInstance.dispatch([{ title: "signal", task: "task", tier: "T1" }])[0]!;
    await managerInstance.receiveSignal(accepted.workerId, { kind: "progress", message: "half" });
    await managerInstance.receiveSignal(accepted.workerId, { kind: "finding", summary: "found" });
    expect(events.filter((event) => event.type === "request")).toHaveLength(0);
    expect(managerInstance.signalLog.snapshot(accepted.workerId)?.latestFinding).toBe("found");

    const waiting = managerInstance.receiveSignal(accepted.workerId, { kind: "request_context", requestId: "r1", question: "need" });
    await vi.waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(events).toContainEqual(expect.objectContaining({ type: "request", workerId: accepted.workerId }));
    managerInstance.respond(accepted.workerId, "r1", { type: "provide_context", context: "provided" });
    await expect(waiting).resolves.toEqual({ type: "provide_context", context: "provided" });
    managerInstance.shutdown();
  });

  it("grant_tools 先切换同一 AgentSession 的 active tools 再恢复 signal", async () => {
    const workerSession: any = { setActiveToolsByName: vi.fn(), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    let signalTool: any;
    let lastToolResult: any;
    const order: string[] = [];
    const managerInstance = manager();
    mockCreateWorkerSession.mockImplementation(async (options: any) => {
      if (!options?.customTools) return workerSession;
      signalTool = options.customTools[0];
      workerSession.prompt = vi.fn(async () => {
        lastToolResult = await signalTool.execute("call", { kind: "request_tools", requestId: "tools-1", tools: ["edit"], reason: "need edit" });
        order.push("resumed");
        workerSession.messages = [{ role: "assistant", content: [{ type: "text", text: "continued" }] }];
      });
      return workerSession;
    });
    const accepted = managerInstance.dispatch([{ title: "grant", task: "task", tier: "T1", addTools: ["edit"] }])[0]!;
    await vi.waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("waiting"));
    workerSession.setActiveToolsByName.mockImplementation(() => order.push("active"));
    managerInstance.respond(accepted.workerId, "tools-1", { type: "grant_tools", tools: ["edit"] });
    await vi.waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("completed"));
    expect(workerSession.setActiveToolsByName).toHaveBeenCalledWith(expect.arrayContaining(["dteam_signal", "edit"]));
    expect(order).toEqual(["active", "resumed"]);
    expect(mockCreateWorkerSession).toHaveBeenCalledTimes(1);
    expect(workerSession.prompt).toHaveBeenCalledTimes(1);
    expect(lastToolResult).toMatchObject({ content: [{ type: "text" }], details: { signal: { type: "grant_tools", tools: ["edit"] } } });
    managerInstance.shutdown();
  });

  it("多个 pending request 回应一项后仍保持 waiting", async () => {
    const instance = manager();
    const accepted = instance.dispatch([{ title: "multi", task: "task", tier: "T1" }])[0]!;
    const first = instance.receiveSignal(accepted.workerId, { kind: "request_context", requestId: "r1", question: "one" });
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    const second = instance.receiveSignal(accepted.workerId, { kind: "request_decision", requestId: "r2", question: "two" });
    instance.respond(accepted.workerId, "r1", { type: "provide_context", context: "ctx" });
    await expect(first).resolves.toMatchObject({ type: "provide_context" });
    expect(instance.get(accepted.workerId)?.state).toBe("waiting");
    instance.respond(accepted.workerId, "r2", { type: "decision", decision: "go" });
    await expect(second).resolves.toMatchObject({ type: "decision" });
    expect(instance.get(accepted.workerId)?.state).toBe("running");
    instance.shutdown();
  });

  it("blocked request 也会暂停并接受 decision", async () => {
    const instance = manager();
    const accepted = instance.dispatch([{ title: "blocked", task: "task", tier: "T1" }])[0]!;
    const waiting = instance.receiveSignal(accepted.workerId, { kind: "blocked", requestId: "blocked-1", reason: "dependency unclear" });
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    instance.respond(accepted.workerId, "blocked-1", { type: "decision", decision: "continue read-only" });
    await expect(waiting).resolves.toEqual({ type: "decision", decision: "continue read-only" });
    instance.shutdown();
  });

  it("终态 worker 和不匹配 request 会被拒绝", async () => {
    const managerInstance = manager();
    expect(() => managerInstance.respond("missing", "r", { type: "deny", reason: "no" })).toThrow();
    const accepted = managerInstance.dispatch([{ title: "signal", task: "task", tier: "T1" }])[0]!;
    const waiting = managerInstance.receiveSignal(accepted.workerId, { kind: "request_decision", requestId: "r1", question: "choose" });
    await vi.waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(() => managerInstance.respond(accepted.workerId, "wrong", { type: "decision", decision: "x" })).toThrow();
    expect(() => managerInstance.respond(accepted.workerId, "r1", { type: "grant_tools", tools: ["edit"] })).toThrow("不能回应 request_decision");
    managerInstance.cancel(accepted.workerId, "test");
    expect(() => managerInstance.respond(accepted.workerId, "r1", { type: "decision", decision: "late" })).toThrow();
    await waiting;
  });
});
