import { waitFor } from "./test-helpers.js";
import { mockCreateWorkerSession } from "./mock-modules.js";
import { beforeEach, describe, expect, it , mock } from "bun:test";

import { RequestState } from "../src/runtime/request-state.js";
import { SignalLog } from "../src/runtime/signal-log.js";
import { makeSignalTool } from "../src/runtime/signal-tool.js";
import { WorkerManager } from "../src/runtime/worker-manager.js";
import { AdaptiveConcurrency } from "../src/dispatch/concurrency.js";
import { workerReport } from "./worker-report.fixture.js";

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

describe("dteam_signal finding parser", () => {
  it("要求 finding 提供非空 evidence 和 impact", async () => {
    const host = { receiveSignal: mock(async (_workerId: string, signal: any) => ({ ok: true, signal })) };
    const tool = makeSignalTool("w", host);
    await expect(tool.execute("call", { kind: "finding", summary: "发现", evidence: "证据" })).rejects.toThrow("finding.impact");
    await expect(tool.execute("call", { kind: "finding", summary: "发现", evidence: "证据", impact: "改变路由" })).resolves.toMatchObject({ details: { signal: { ok: true } } });
    expect(host.receiveSignal).toHaveBeenCalledWith("w", { kind: "finding", summary: "发现", evidence: "证据", impact: "改变路由" });
  });

  it("拒绝 finding 的额外字段和超长字段，并与公开 schema 一致", async () => {
    const host = { receiveSignal: mock(async (_workerId: string, signal: any) => ({ ok: true, signal })) };
    const tool = makeSignalTool("w", host);
    expect(tool.parameters.additionalProperties).toBe(false);
    expect(tool.parameters.properties.summary).toMatchObject({ minLength: 1, maxLength: 1000 });
    await expect(tool.execute("call", { kind: "finding", summary: "发现", evidence: "证据", impact: "改变路由", extra: "拒绝" })).rejects.toThrow("不允许字段");
    await expect(tool.execute("call", { kind: "finding", summary: "发现", evidence: "证据", impact: "改变路由", message: "进度字段" })).rejects.toThrow("finding 不允许字段 message");
    await expect(tool.execute("call", { kind: "finding", summary: "发现", evidence: "证据", impact: "改变路由", requestId: "跨类型" })).rejects.toThrow("finding 不允许字段 requestId");
    await expect(tool.execute("call", { kind: "finding", summary: "x".repeat(1001), evidence: "证据", impact: "改变路由" })).rejects.toThrow("字符上限");
    await expect(tool.execute("call", { kind: "finding", summary: "发现", evidence: "x".repeat(1001), impact: "改变路由" })).rejects.toThrow("字符上限");
    await expect(tool.execute("call", { kind: "finding", summary: "发现", evidence: "证据", impact: "x".repeat(1001) })).rejects.toThrow("字符上限");
    expect(host.receiveSignal).not.toHaveBeenCalled();
  });
});

describe("worker signal protocol", () => {
  it("progress 不打断主代理，带证据 finding 进入事件且阻塞 request 可由 respond 恢复", async () => {
    const events: any[] = [];
    const managerInstance = manager((event) => { events.push(event); });
    const accepted = managerInstance.dispatch([{ title: "signal", task: "task", tier: "T1" }])[0]!;
    await managerInstance.receiveSignal(accepted.workerId, { kind: "progress", message: "half" });
    await managerInstance.receiveSignal(accepted.workerId, {
      kind: "finding",
      summary: "found password=hunter2",
      evidence: "config.ts:12",
      impact: "必须调整后续路由",
    });
    expect(events.filter((event) => event.type === "request")).toHaveLength(0);
    expect(events.filter((event) => event.type === "finding")).toHaveLength(1);
    expect(events.find((event) => event.type === "finding")?.payload.findings[0]).toMatchObject({
      summary: "found password=[REDACTED_SECRET]",
      evidence: "config.ts:12",
      impact: "必须调整后续路由",
    });
    expect(managerInstance.get(accepted.workerId)?.state).toBe("running");
    expect(JSON.stringify(managerInstance.signalLog.eventsFor(accepted.workerId))).not.toContain("hunter2");
    expect(managerInstance.signalLog.snapshot(accepted.workerId)?.latestFinding).toBe("found password=[REDACTED_SECRET]");

    const waiting = managerInstance.receiveSignal(accepted.workerId, { kind: "request_context", requestId: "r1", question: "need" });
    await waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(events).toContainEqual(expect.objectContaining({ type: "request", workerId: accepted.workerId }));
    managerInstance.respond(accepted.workerId, "r1", { type: "provide_context", context: "provided" });
    await expect(waiting).resolves.toEqual({ type: "provide_context", context: "provided" });
    managerInstance.shutdown();
  });

  it("短窗 finding 按 worker 有界合并并去重", async () => {
    const events: any[] = [];
    const available = mock();
    const instance = manager((event) => events.push(event), { onParentEventAvailable: available });
    const accepted = instance.dispatch([{ title: "合并", task: "task", tier: "T1" }])[0]!;
    const finding = { kind: "finding" as const, summary: "同一发现", evidence: "a.ts:1", impact: "改路由" };
    await instance.receiveSignal(accepted.workerId, finding);
    await instance.receiveSignal(accepted.workerId, finding);
    await instance.receiveSignal(accepted.workerId, { ...finding, summary: "第二发现", evidence: "b.ts:2" });
    expect(events).toEqual([]);
    instance.flushParentEvents();
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "finding", workerId: accepted.workerId });
    expect(events[0].payload.findings).toHaveLength(2);
    expect(available).toHaveBeenCalled();
    instance.shutdown();
  });

  it("重复 requestId 被拒绝且不破坏原 pending request", async () => {
    const instance = manager();
    const accepted = instance.dispatch([{ title: "重复", task: "task", tier: "T1" }])[0]!;
    const first = instance.receiveSignal(accepted.workerId, { kind: "request_context", requestId: "same", question: "one" });
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
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
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
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
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("failed"));
    expect(instance.get(accepted.workerId)?.error).toContain("重新 dispatch fresh worker");
    instance.shutdown();
  });

  it("批准工具额度会恢复同一 AgentSession，不创建 fresh retry", async () => {
    const workerSession: any = { abort: mock().mockResolvedValue(undefined), messages: [] };
    let signalTool: any;
    let reportTool: any;
    let sessionCalls = 0;
    const instance = manager();
    mockCreateWorkerSession.mockImplementation(async (options: any) => {
      if (!options?.customTools) return { prompt: mock().mockResolvedValue(undefined), abort: mock().mockResolvedValue(undefined), messages: [] };
      sessionCalls += 1;
      signalTool = options.customTools[0];
      reportTool = options.customTools[1];
      workerSession.prompt = mock(async () => {
        await signalTool.execute("call", { kind: "request_tool_budget", requestId: "budget-session", reason: "需要继续" });
        await reportTool.execute("call", workerReport({ summary: "continued" }));
        workerSession.messages = [{ role: "assistant", content: [{ type: "text", text: "continued" }] }];
      });
      return workerSession;
    });
    const accepted = instance.dispatch([{ title: "恢复额度", task: "task", tier: "T3" }])[0]!;
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    instance.respond(accepted.workerId, "budget-session", { type: "grant_tool_budget", additionalCalls: 60 });
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("completed"));
    expect(sessionCalls).toBe(1);
    expect(workerSession.prompt).toHaveBeenCalledTimes(1);
    expect(instance.get(accepted.workerId)).toMatchObject({ result: "continued", toolCallBudget: 120, toolBudgetExtensionCount: 1 });
    instance.shutdown();
  });

  it("grant_tools 的 session API 失败时清理 pending 并返回 deny", async () => {
    const workerSession: any = { setActiveToolsByName: mock(() => { throw new Error("tool switch failed"); }), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(workerSession);
    const instance = manager();
    const accepted = instance.dispatch([{ title: "授权失败", task: "task", tier: "T1", addTools: ["edit"], writeScope: ["src/"] }])[0]!;
    const waiting = instance.receiveSignal(accepted.workerId, { kind: "request_tools", requestId: "tools-fail", tools: ["edit"], reason: "need" });
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(() => instance.respond(accepted.workerId, "tools-fail", { type: "grant_tools", tools: ["edit"] })).not.toThrow();
    await expect(waiting).resolves.toMatchObject({ type: "deny" });
    expect(instance.requestState.list()).toHaveLength(0);
    instance.shutdown();
  });

  it("grant_tools 先切换同一 AgentSession 的 active tools 再恢复 signal", async () => {
    const workerSession: any = { setActiveToolsByName: mock(), abort: mock().mockResolvedValue(undefined), messages: [] };
    let signalTool: any;
    let reportTool: any;
    let lastToolResult: any;
    const order: string[] = [];
    const managerInstance = manager();
    mockCreateWorkerSession.mockImplementation(async (options: any) => {
      if (!options?.customTools) return workerSession;
      signalTool = options.customTools[0];
      reportTool = options.customTools[1];
      workerSession.prompt = mock(async () => {
        lastToolResult = await signalTool.execute("call", { kind: "request_tools", requestId: "tools-1", tools: ["edit"], reason: "need edit" });
        order.push("resumed");
        await reportTool.execute("call", workerReport({ summary: "continued" }));
        workerSession.messages = [{ role: "assistant", content: [{ type: "text", text: "continued" }] }];
      });
      return workerSession;
    });
    const accepted = managerInstance.dispatch([{ title: "grant", task: "task", tier: "T1", addTools: ["edit"], writeScope: ["src/"] }])[0]!;
    await waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("waiting"));
    workerSession.setActiveToolsByName.mockImplementation(() => order.push("active"));
    managerInstance.respond(accepted.workerId, "tools-1", { type: "grant_tools", tools: ["edit"] });
    await waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("completed"));
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
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
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
    await waitFor(() => expect(instance.get(accepted.workerId)?.state).toBe("waiting"));
    instance.respond(accepted.workerId, "blocked-1", { type: "decision", decision: "continue read-only" });
    await expect(waiting).resolves.toEqual({ type: "decision", decision: "continue read-only" });
    instance.shutdown();
  });

  it("终态 worker 和不匹配 request 会被拒绝", async () => {
    const managerInstance = manager();
    expect(() => managerInstance.respond("missing", "r", { type: "deny", reason: "no" })).toThrow();
    const accepted = managerInstance.dispatch([{ title: "signal", task: "task", tier: "T1" }])[0]!;
    const waiting = managerInstance.receiveSignal(accepted.workerId, { kind: "request_decision", requestId: "r1", question: "choose" });
    await waitFor(() => expect(managerInstance.get(accepted.workerId)?.state).toBe("waiting"));
    expect(() => managerInstance.respond(accepted.workerId, "wrong", { type: "decision", decision: "x" })).toThrow();
    expect(() => managerInstance.respond(accepted.workerId, "r1", { type: "grant_tools", tools: ["edit"] })).toThrow("不能回应 request_decision");
    managerInstance.cancel(accepted.workerId, "test");
    expect(() => managerInstance.respond(accepted.workerId, "r1", { type: "decision", decision: "late" })).toThrow();
    await waiting;
  });
});
