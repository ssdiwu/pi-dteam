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
    await managerInstance.receiveSignal(accepted.workerId, { kind: "finding", summary: "found password=hunter2" });
    expect(events.filter((event) => event.type === "request")).toHaveLength(0);
    expect(JSON.stringify(managerInstance.signalLog.eventsFor(accepted.workerId))).not.toContain("hunter2");
    expect(managerInstance.signalLog.snapshot(accepted.workerId)?.latestFinding).toBe("found password=[REDACTED_SECRET]");

    const waiting = managerInstance.receiveSignal(accepted.workerId, { kind: "request_context", requestId: "r1", question: "need" });
    await vi.waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(events).toContainEqual(expect.objectContaining({ type: "request", workerId: accepted.workerId }));
    managerInstance.respond(accepted.workerId, "r1", { type: "provide_context", context: "provided" });
    await expect(waiting).resolves.toEqual({ type: "provide_context", context: "provided" });
    managerInstance.shutdown();
  });

  it("重复 requestId 被拒绝且不破坏原 pending request", async () => {
    const instance = manager();
    const accepted = instance.dispatch([{ title: "重复", task: "task", tier: "T1" }])[0]!;
    const first = instance.receiveSignal(accepted.workerId, { kind: "request_context", requestId: "same", question: "one" });
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    await expect(instance.receiveSignal(accepted.workerId, { kind: "request_context", requestId: "same", question: "duplicate" })).resolves.toMatchObject({ type: "deny" });
    expect(instance.requestState.list()).toHaveLength(1);
    instance.respond(accepted.workerId, "same", { type: "provide_context", context: "ctx" });
    await expect(first).resolves.toMatchObject({ type: "provide_context" });
    instance.shutdown();
  });

  it("worker 可请求一次工具调用额度，主代理只接受 60–120 的十位倍数", async () => {
    const events: any[] = [];
    const instance = manager((event) => events.push(event));
    const accepted = instance.dispatch([{ title: "额度", task: "task", tier: "T3" }])[0]!;
    const waiting = instance.receiveSignal(accepted.workerId, { kind: "request_tool_budget", requestId: "budget-1", reason: "还需读取相关文件" });
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(events).toContainEqual(expect.objectContaining({
      type: "request",
      workerId: accepted.workerId,
      payload: expect.objectContaining({ kind: "request_tool_budget", toolCallBudget: 60, toolBudgetExtensionCount: 0 }),
    }));
    expect(() => instance.respond(accepted.workerId, "budget-1", { type: "grant_tool_budget", additionalCalls: 50 })).toThrow("60–120");
    expect(() => instance.respond(accepted.workerId, "budget-1", { type: "grant_tool_budget", additionalCalls: 65 })).toThrow("10 的倍数");
    instance.respond(accepted.workerId, "budget-1", { type: "grant_tool_budget", additionalCalls: 60 });
    await expect(waiting).resolves.toEqual({ type: "grant_tool_budget", additionalCalls: 60 });
    expect(instance.get(accepted.workerId)).toMatchObject({ state: "running", toolCallBudget: 120, toolBudgetExtensionCount: 1 });

    await expect(instance.receiveSignal(accepted.workerId, { kind: "request_tool_budget", requestId: "budget-2", reason: "仍不足" })).resolves.toEqual(expect.objectContaining({ type: "deny" }));
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("failed"));
    expect(instance.get(accepted.workerId)?.error).toContain("重新 dispatch fresh worker");
    instance.shutdown();
  });

  it("批准工具额度会恢复同一 AgentSession，不创建 fresh retry", async () => {
    const workerSession: any = { abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    let signalTool: any;
    let sessionCalls = 0;
    const instance = manager();
    mockCreateWorkerSession.mockImplementation(async (options: any) => {
      if (!options?.customTools) return { prompt: vi.fn().mockResolvedValue(undefined), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
      sessionCalls += 1;
      signalTool = options.customTools[0];
      workerSession.prompt = vi.fn(async () => {
        await signalTool.execute("call", { kind: "request_tool_budget", requestId: "budget-session", reason: "需要继续" });
        workerSession.messages = [{ role: "assistant", content: [{ type: "text", text: "continued" }] }];
      });
      return workerSession;
    });
    const accepted = instance.dispatch([{ title: "恢复额度", task: "task", tier: "T3" }])[0]!;
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    instance.respond(accepted.workerId, "budget-session", { type: "grant_tool_budget", additionalCalls: 60 });
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("completed"));
    expect(sessionCalls).toBe(1);
    expect(workerSession.prompt).toHaveBeenCalledTimes(1);
    expect(instance.get(accepted.workerId)).toMatchObject({ result: "continued", toolCallBudget: 120, toolBudgetExtensionCount: 1 });
    instance.shutdown();
  });

  it("grant_tools 的 session API 失败时清理 pending 并返回 deny", async () => {
    const workerSession: any = { setActiveToolsByName: vi.fn(() => { throw new Error("tool switch failed"); }), abort: vi.fn().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(workerSession);
    const instance = manager();
    const accepted = instance.dispatch([{ title: "授权失败", task: "task", tier: "T1", addTools: ["edit"] }])[0]!;
    const waiting = instance.receiveSignal(accepted.workerId, { kind: "request_tools", requestId: "tools-fail", tools: ["edit"], reason: "need" });
    await vi.waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(() => instance.respond(accepted.workerId, "tools-fail", { type: "grant_tools", tools: ["edit"] })).not.toThrow();
    await expect(waiting).resolves.toMatchObject({ type: "deny" });
    expect(instance.requestState.list()).toHaveLength(0);
    instance.shutdown();
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
