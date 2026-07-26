import { waitFor } from "./test-helpers.js";
import { mockCreateWorkerSession } from "./mock-modules.js";
import { beforeEach, describe, expect, it, mock } from "bun:test";

const { mockLoadDteamConfig } = { mockLoadDteamConfig: mock() };
mock.module("../src/session/model-config.js", () => ({
  loadDteamConfig: mockLoadDteamConfig,
  formatDteamConfigWarning: mock((status: any) => status.errors.join(";")),
}));

import registerDteam, { sendParentEvent } from "../index.js";
import { workerReport } from "./worker-report.fixture.js";

function register() {
  const pi = {
    on: mock(), registerTool: mock(), registerCommand: mock(), sendMessage: mock(),
    getActiveTools: mock(() => ["read", "grep", "find", "ls", "bash", "edit", "write"]),
  };
  registerDteam(pi as any);
  const tools = Object.fromEntries(pi.registerTool.mock.calls.map(([tool]: any[]) => [tool.name, tool]));
  return { pi, tools, command: pi.registerCommand.mock.calls[0][1] };
}

function context() {
  return {
    cwd: "/workspace", model: { provider: "ctx", id: "model" },
    modelRegistry: { authStorage: {}, find: mock(() => ({ provider: "ctx", id: "model" })) },
    sessionManager: { getSessionId: mock(() => "parent-session") },
    isIdle: mock(() => false),
    ui: { setStatus: mock(), notify: mock() },
  };
}

describe("dteam next-major extension entry", () => {
  beforeEach(() => {
    mock.clearAllMocks();
    mockLoadDteamConfig.mockReturnValue({ path: "/tmp/pi-dteam.json", exists: true, valid: true, routes: { T1: { primary: "ctx/model" }, T2: { primary: "ctx/model" }, T3: { primary: "ctx/model" } }, missingTiers: [], errors: [] });
  });

  it("配置缺失时派发工具拒绝执行", async () => {
    mockLoadDteamConfig.mockReturnValue({ path: "/tmp/pi-dteam.json", exists: false, valid: false, routes: {}, missingTiers: ["T1", "T2", "T3"], errors: ["未找到配置文件"] });
    const { pi, tools } = register();
    const start = pi.on.mock.calls.find(([event]: any[]) => event === "session_start")?.[1];
    const ctx = context(); start!({}, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("未找到配置文件", "warning");
    await expect(tools.dteam_dispatch.execute("call", { workers: [{ title: "x", task: "x", tier: "T3" }] }, undefined, undefined, ctx)).resolves.toMatchObject({ isError: true });
  });

  it("注册四工具、/dteam 命令与会话钩子", () => {
    const { pi, tools } = register();
    expect(Object.keys(tools).sort()).toEqual(["dteam_dispatch", "dteam_recover", "dteam_respond", "dteam_wait"]);
    expect(pi.registerCommand).toHaveBeenCalledWith("dteam", expect.any(Object));
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("agent_settled", expect.any(Function));
  });

  it("模型目录可用性解析失败时隐藏原始认证错误", async () => {
    const { command } = register();
    const ctx = context();
    ctx.modelRegistry.getAvailable = mock(async () => { throw new Error("credential secret must not appear"); });
    ctx.ui.custom = mock(async (factory: any) => {
      const modal = factory({ requestRender: mock() }, {}, {}, mock());
      modal.render(80);
    });

    await command.handler("", ctx);

    expect(ctx.ui.notify).toHaveBeenCalledWith("无法读取当前可用模型；目录为空。", "warning");
    expect(ctx.ui.notify).not.toHaveBeenCalledWith(expect.stringContaining("credential secret"), "warning");
  });

  it("工具描述表达分级、报告、交接、写入守卫和显式等待", () => {
    const { tools } = register();
    expect(tools.dteam_dispatch.description).toContain("dteam_report");
    expect(tools.dteam_dispatch.description).toContain("activities");
    expect(tools.dteam_dispatch.description).toContain("verification");
    expect(tools.dteam_dispatch.description).toContain("多轮");
    expect(tools.dteam_dispatch.description).toContain("writeScope");
    expect(tools.dteam_dispatch.description).toContain("自包含、相互独立的任务");
    expect(tools.dteam_dispatch.description).not.toContain("pi-dgoal");
    expect(tools.dteam_dispatch.description).not.toContain("外部 Plan");
    expect(tools.dteam_dispatch.description).not.toContain("ready task");
    expect(tools.dteam_dispatch.description).not.toContain("plan_update");
    expect(tools.dteam_respond.description).toContain("普通阻塞");
    expect(tools.dteam_recover.description).toContain("timeout recovery");
    expect(tools.dteam_wait.description).toContain("依赖指定 worker");
  });

  it("压缩后仅向下一次 context 注入未收口 worker 的内存摘要", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const { pi, tools } = register();
    const ctx = context();
    const start = pi.on.mock.calls.find(([event]: any[]) => event === "session_start")?.[1];
    const compact = pi.on.mock.calls.find(([event]: any[]) => event === "session_compact")?.[1];
    const injectContext = pi.on.mock.calls.find(([event]: any[]) => event === "context")?.[1];
    const shutdown = pi.on.mock.calls.find(([event]: any[]) => event === "session_shutdown")?.[1];
    start!({}, ctx);
    await tools.dteam_dispatch.execute("dispatch", { workers: [{ title: "待决 worker", task: "检查范围", tier: "T3" }] }, undefined, undefined, ctx);
    await waitFor(() => expect(hanging.prompt).toHaveBeenCalled());
    compact!({}, ctx);
    const first = injectContext!({ messages: [] }, ctx);
    expect(first.messages).toHaveLength(1);
    expect(first.messages[0]).toMatchObject({ role: "custom", customType: "dteam-compaction-resync", display: false });
    expect(first.messages[0].content).toContain("<dteam_resync>");
    expect(first.messages[0].content).toContain("待决 worker");
    expect(injectContext!({ messages: [] }, ctx)).toBeUndefined();
    shutdown!({}, ctx);
  });

  it.each([0, 33])("dispatch 拒绝 workers 数量 %s", async (count) => {
    const { tools } = register();
    const response = await tools.dteam_dispatch.execute("call", { workers: Array.from({ length: count }, (_, i) => ({ title: String(i), task: "x", tier: "T3" })) }, undefined, undefined, context());
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("workers 数量必须是 1–32");
  });

  it("respond 和 recover 分别 fail-closed 校验自己的 schema", async () => {
    const { tools } = register();
    await expect(tools.dteam_respond.execute("call", { workerId: "w", requestId: "r", response: { type: "provide_context" } }, undefined, undefined, context())).resolves.toMatchObject({ isError: true });
    await expect(tools.dteam_recover.execute("call", { workerId: "w", requestId: "r", action: "escalate" }, undefined, undefined, context())).resolves.toMatchObject({ isError: true });
  });

  it("工具默认紧凑渲染，展开时仍显示人类可读详情", () => {
    const { tools } = register();
    const result = { content: [{ type: "text", text: '{\n  "accepted": []\n}' }], details: { accepted: [{ tier: "T3" }] } };
    expect(tools.dteam_dispatch.renderResult(result, { expanded: false }, {}, {}).render(120).join("\n")).toContain("已受理 1 个 worker");
    const expanded = tools.dteam_dispatch.renderResult(result, { expanded: true }, {}, {}).render(120).join("\n");
    expect(expanded).toContain("未命名");
    expect(expanded).not.toContain("accepted");
    expect(expanded).not.toContain("{");
  });

  it("wait schema 要求 workerIds 与 1–300000 的整数 timeoutMs", async () => {
    const { tools } = register();
    const timeoutMs = tools.dteam_wait.parameters.properties.timeoutMs;
    expect(timeoutMs).toMatchObject({ type: "integer", minimum: 1, maximum: 300_000 });
    await expect(tools.dteam_wait.execute("call", { workerIds: ["w"] }, undefined, undefined, context())).resolves.toMatchObject({ isError: true });
  });

  it("wait 执行中推送包含目标与 elapsed 的进度", async () => {
    const hanging = { prompt: mock(() => new Promise<void>(() => {})), abort: mock().mockResolvedValue(undefined), messages: [] };
    mockCreateWorkerSession.mockResolvedValue(hanging);
    const { tools } = register();
    const ctx = context();
    const dispatched = await tools.dteam_dispatch.execute("dispatch", { workers: [{ title: "等待检查", task: "任务", tier: "T3" }] }, undefined, undefined, ctx);
    const workerId = dispatched.details.accepted[0].workerId;
    const onUpdate = mock();
    await expect(tools.dteam_wait.execute("wait", { workerIds: [workerId], timeoutMs: 10 }, undefined, onUpdate, ctx)).resolves.toMatchObject({ details: { result: { reason: "timeout", targetWorkers: [{ id: workerId, title: "等待检查" }], timeoutMs: 10 } } });
    expect(onUpdate).toHaveBeenCalledWith(expect.objectContaining({ details: { waiting: expect.objectContaining({ targetWorkers: [{ id: workerId, title: "等待检查" }], timeoutMs: 10 }) } }));
  });

  it("wait 消费完成事件后仍清理状态栏", async () => {
    let finish!: () => void;
    const session = {
      prompt: mock(() => new Promise<void>((resolve) => { finish = resolve; })),
      abort: mock().mockResolvedValue(undefined),
      messages: [{ role: "assistant", content: [
        { type: "text", text: "完成" },
        { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: "完成" }) },
      ] }],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const { tools } = register();
    const ctx = context();
    const dispatched = await tools.dteam_dispatch.execute("dispatch", { workers: [{ title: "状态栏检查", task: "任务", tier: "T3" }] }, undefined, undefined, ctx);
    const workerId = dispatched.details.accepted[0].workerId;
    await waitFor(() => expect(session.prompt).toHaveBeenCalled());
    expect(ctx.ui.setStatus).toHaveBeenCalledWith("dteam", "1 个 worker 运行中");

    const waiting = tools.dteam_wait.execute("wait", { workerIds: [workerId], timeoutMs: 1_000 }, undefined, undefined, ctx);
    finish();

    await expect(waiting).resolves.toMatchObject({ details: { result: { reason: "worker_event", ready: [expect.objectContaining({ id: workerId, state: "completed" })] } } });
    expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("dteam", undefined);
  });

  it("wait 在完成后消费事件，agent_settled 不再回放", async () => {
    const session = {
      prompt: mock().mockResolvedValue(undefined),
      abort: mock().mockResolvedValue(undefined),
      messages: [{ role: "assistant", content: [
        { type: "text", text: "完成" },
        { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: "完成" }) },
      ] }],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const { pi, tools } = register();
    const ctx = context();
    const start = pi.on.mock.calls.find(([event]: any[]) => event === "session_start")?.[1];
    const settled = pi.on.mock.calls.find(([event]: any[]) => event === "agent_settled")?.[1];
    start!({}, ctx);
    const dispatched = await tools.dteam_dispatch.execute("dispatch", { workers: [{ title: "单次消费", task: "任务", tier: "T3" }] }, undefined, undefined, ctx);
    const workerId = dispatched.details.accepted[0].workerId;
    await waitFor(() => expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("dteam", undefined));

    await expect(tools.dteam_wait.execute("wait", { workerIds: [workerId], timeoutMs: 1_000 }, undefined, undefined, ctx)).resolves.toMatchObject({
      details: { result: { reason: "worker_event", ready: [expect.objectContaining({ id: workerId, state: "completed" })] } },
    });
    settled!({}, ctx);
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("无 assistant 文本的只读失败在 agent_settled 后不回放", async () => {
    const session = {
      prompt: mock().mockResolvedValue(undefined),
      abort: mock().mockResolvedValue(undefined),
      messages: [],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const { pi, tools } = register();
    const ctx = context();
    const start = pi.on.mock.calls.find(([event]: any[]) => event === "session_start")?.[1];
    const settled = pi.on.mock.calls.find(([event]: any[]) => event === "agent_settled")?.[1];
    start!({}, ctx);
    await tools.dteam_dispatch.execute("dispatch", { workers: [{ title: "无输出只读", task: "任务", tier: "T3" }] }, undefined, undefined, ctx);
    await waitFor(() => expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("dteam", undefined));

    settled!({}, ctx);
    settled!({}, ctx);
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("未被 wait 消费的事件在 agent_settled 后只回放一次", async () => {
    const session = {
      prompt: mock().mockResolvedValue(undefined),
      abort: mock().mockResolvedValue(undefined),
      messages: [{ role: "assistant", content: [
        { type: "text", text: "完成" },
        { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: "完成" }) },
      ] }],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const { pi, tools } = register();
    const ctx = context();
    const start = pi.on.mock.calls.find(([event]: any[]) => event === "session_start")?.[1];
    const settled = pi.on.mock.calls.find(([event]: any[]) => event === "agent_settled")?.[1];
    start!({}, ctx);
    await tools.dteam_dispatch.execute("dispatch", { workers: [{ title: "后台回放", task: "任务", tier: "T3" }] }, undefined, undefined, ctx);
    await waitFor(() => expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("dteam", undefined));

    settled!({}, ctx);
    settled!({}, ctx);
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
    expect(pi.sendMessage.mock.calls[0]?.[1]).toMatchObject({ deliverAs: "followUp", triggerTurn: true });
  });

  it("Pi 0.78 agent_end idle fallback 只回放一次", async () => {
    const session = {
      prompt: mock().mockResolvedValue(undefined),
      abort: mock().mockResolvedValue(undefined),
      messages: [{ role: "assistant", content: [
        { type: "text", text: "完成" },
        { type: "toolCall", name: "dteam_report", arguments: workerReport({ summary: "完成" }) },
      ] }],
    };
    mockCreateWorkerSession.mockResolvedValue(session);
    const { pi, tools } = register();
    const ctx = context();
    const start = pi.on.mock.calls.find(([event]: any[]) => event === "session_start")?.[1];
    const ended = pi.on.mock.calls.find(([event]: any[]) => event === "agent_end")?.[1];
    start!({}, ctx);
    await tools.dteam_dispatch.execute("dispatch", { workers: [{ title: "旧版 settled", task: "任务", tier: "T3" }] }, undefined, undefined, ctx);
    await waitFor(() => expect(ctx.ui.setStatus).toHaveBeenLastCalledWith("dteam", undefined));
    ctx.isIdle.mockReturnValue(true);

    ended!({ messages: [] }, ctx);
    await waitFor(() => expect(pi.sendMessage).toHaveBeenCalledTimes(1));
    ended!({ messages: [] }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(pi.sendMessage).toHaveBeenCalledTimes(1);
  });

  it("agent_end 兼容 tick 忽略 session shutdown 后的 stale ctx", async () => {
    const { pi } = register();
    const ctx = context();
    ctx.isIdle.mockImplementation(() => { throw new Error("stale ctx"); });
    const ended = pi.on.mock.calls.find(([event]: any[]) => event === "agent_end")?.[1];

    ended!({ messages: [] }, ctx);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(pi.sendMessage).not.toHaveBeenCalled();
  });

  it("worker 内部事件不直接展示到主对话且会脱敏", () => {
    const pi = { sendMessage: mock() };
    sendParentEvent(pi as any, { type: "failed", workerId: "w", title: "api_key=sk-title-secret", payload: { result: "api_key=sk-12345678901234567890 DATABASE_URL=postgresql://u:pw@example.test/db" } } as any);
    const message = pi.sendMessage.mock.calls[0]?.[0];
    expect(message).toMatchObject({ customType: "dteam-worker", display: false });
    expect(JSON.stringify(message)).not.toContain("sk-title-secret");
    expect(JSON.stringify(message)).not.toContain("postgresql://u:pw@example.test/db");
  });
});
