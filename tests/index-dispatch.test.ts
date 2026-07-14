import { beforeEach, describe, expect, it, vi } from "vitest";
const { mockCreateWorkerSession, mockLoadDteamConfig } = vi.hoisted(() => ({ mockCreateWorkerSession: vi.fn(), mockLoadDteamConfig: vi.fn() }));
vi.mock("../src/session.js", () => ({ createWorkerSession: mockCreateWorkerSession }));
vi.mock("../src/session/model-config.js", () => ({
  loadDteamConfig: mockLoadDteamConfig,
  formatDteamConfigWarning: vi.fn((status: any) => status.errors.join(";")),
}));
import registerDteam, { sendParentEvent } from "../index.js";

function register() {
  const pi = {
    on: vi.fn(),
    registerTool: vi.fn(),
    registerCommand: vi.fn(),
    sendMessage: vi.fn(),
    getActiveTools: vi.fn(() => ["read", "grep", "find", "ls", "bash", "edit", "write"]),
  };
  registerDteam(pi as any);
  return { pi, tool: pi.registerTool.mock.calls[0][0], command: pi.registerCommand.mock.calls[0][1] };
}

function context() {
  return {
    cwd: "/workspace",
    model: { provider: "ctx", id: "model" },
    modelRegistry: { authStorage: {}, find: vi.fn(() => ({ provider: "ctx", id: "model" })) },
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  };
}

describe("dteam 0.8 extension entry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    mockLoadDteamConfig.mockReturnValue({ path: "/tmp/pi-dteam.json", exists: true, valid: true, routes: { T1: { primary: "ctx/model" }, T2: { primary: "ctx/model" }, T3: { primary: "ctx/model" } }, missingTiers: [], errors: [] });
  });

  it("配置缺失时 session 启动显著提醒且工具拒绝派发", async () => {
    mockLoadDteamConfig.mockReturnValue({ path: "/tmp/pi-dteam.json", exists: false, valid: false, routes: {}, missingTiers: ["T1", "T2", "T3"], errors: ["未找到配置文件"] });
    const { pi, tool } = register();
    const start = pi.on.mock.calls.find(([event]: any[]) => event === "session_start")?.[1];
    expect(start).toBeTypeOf("function");
    const ctx = context();
    start!({}, ctx);
    expect(ctx.ui.notify).toHaveBeenCalledWith("未找到配置文件", "warning");
    const response = await tool.execute("call", { type: "dispatch", workers: [{ title: "x", task: "x", tier: "T3" }] }, undefined, undefined, ctx);
    expect(response.isError).toBe(true);
  });

  it("工具描述提供档位选择和基本用法", () => {
    const { tool } = register();
    expect(tool.description).toContain("T3=明确、机械、可独立验证的小任务");
    expect(tool.description).toContain("跨档只能由主代理按 T3→T2→T1 明确决定");
    expect(tool.description).toContain("type=dispatch");
    expect(tool.description).toContain("type=respond");
    expect(tool.description).toContain("需 addTools 才能额外调用");
    expect(tool.description).toContain("respond 回应 waiting worker 或 timeout recovery 的结构化请求");
    expect(tool.description).toContain("T3=60、T2=120、T1=180");
    expect(tool.description).toContain("一次性追加 60–120 次（10 的倍数）");
    expect(tool.description).toContain("worker 每次 attempt 默认五分钟");
    expect(tool.description).toContain("timeout recovery 独立累计上限十分钟");
    expect(tool.description).toContain("实时文本、thinking、当前工具和 timeout 诊断只投影到 Snapshot");
  });

  it("只注册一个 dteam 工具和同名 /dteam 命令", () => {
    const { pi, tool } = register();
    expect(pi.registerTool).toHaveBeenCalledTimes(1);
    expect(tool.name).toBe("dteam");
    expect(pi.registerCommand).toHaveBeenCalledWith("dteam", expect.any(Object));
    expect(pi.on).toHaveBeenCalledWith("session_start", expect.any(Function));
    expect(pi.on).toHaveBeenCalledWith("session_shutdown", expect.any(Function));
  });

  it.each([0, 33])("拒绝 workers 数量 %s", async (count) => {
    const { tool } = register();
    const response = await tool.execute("call", { type: "dispatch", workers: Array.from({ length: count }, (_, i) => ({ title: String(i), task: "x", tier: "T3" })) }, undefined, undefined, context());
    expect(response.isError).toBe(true);
    expect(response.content[0].text).toContain("workers 数量必须是 1–32");
  });

  it("respond 拒绝非法 timeout recovery 和工具额度 schema", async () => {
    const { tool } = register();
    const badTimeout = tool.execute("call", { type: "respond", workerId: "w", requestId: "r", response: { type: "escalate" } }, undefined, undefined, context());
    await expect(badTimeout).resolves.toMatchObject({ isError: true });
    const badBudget = tool.execute("call", { type: "respond", workerId: "w", requestId: "r", response: { type: "grant_tool_budget", additionalCalls: "60" } }, undefined, undefined, context());
    await expect(badBudget).resolves.toMatchObject({ isError: true });
  });

  it("worker 内部事件不直接展示到主对话，避免重复显示", () => {
    const pi = { sendMessage: vi.fn() };
    sendParentEvent(pi as any, { type: "failed", workerId: "w", title: "审查", payload: { error: "failed", state: "failed" } } as any);
    expect(pi.sendMessage).toHaveBeenCalledWith(expect.objectContaining({ customType: "dteam-worker", display: false }), expect.any(Object));
  });

  it("parent event 不转发 worker 输出中的常见敏感值", () => {
    const pi = { sendMessage: vi.fn() };
    sendParentEvent(pi as any, { type: "completed", workerId: "w", title: "api_key=sk-title-secret", payload: { result: "api_key=sk-12345678901234567890 DATABASE_URL=postgresql://u:pw@example.test/db" } } as any);
    const message = pi.sendMessage.mock.calls[0]?.[0];
    expect(JSON.stringify(message)).not.toContain("sk-title-secret");
    expect(JSON.stringify(message)).not.toContain("sk-12345678901234567890");
    expect(JSON.stringify(message)).not.toContain("postgresql://u:pw@example.test/db");
  });

  it("详情以 worker ID 保持终态化的原记录", async () => {
    let finishFirst!: () => void;
    const first: any = {
      abort: vi.fn().mockResolvedValue(undefined),
      setActiveToolsByName: vi.fn(),
      messages: [],
      prompt: vi.fn(() => new Promise<void>((resolve) => {
        finishFirst = () => {
          first.messages = [{ role: "assistant", content: [{ type: "text", text: "first complete" }] }];
          resolve();
        };
      })),
    };
    const second: any = { abort: vi.fn().mockResolvedValue(undefined), setActiveToolsByName: vi.fn(), messages: [], prompt: vi.fn(() => new Promise<void>(() => {})) };
    mockCreateWorkerSession.mockResolvedValueOnce(first).mockResolvedValueOnce(second);
    const { pi, tool, command } = register();
    let component: any;
    const ctx = context();
    (ctx.ui as any).custom = vi.fn(async (factory: any) => {
      component = factory({ requestRender: vi.fn() }, {}, undefined, vi.fn());
    });
    await tool.execute("call", { type: "dispatch", workers: [
      { title: "first", task: "first", tier: "T3" },
      { title: "second", task: "second", tier: "T3" },
    ] }, undefined, undefined, ctx);
    await vi.waitFor(() => expect(first.prompt).toHaveBeenCalled());
    await command.handler("", ctx);
    component.handleInput("\r");
    expect(component.render(80).join("\n")).toContain("first");
    finishFirst();
    await vi.waitFor(() => expect(component.render(80).join("\n")).toContain("只读封存"));
    expect(component.render(80).join("\n")).toContain("first");
    expect(component.render(80).join("\n")).not.toContain("second");
    const shutdown = pi.on.mock.calls.find(([event]: any[]) => event === "session_shutdown")?.[1];
    shutdown!({}, ctx);
  });

  it("工具 schema 保持 Pi 兼容，并由 runtime 做分支 fail-closed 校验", () => {
    const { tool } = register();
    expect(tool.parameters.type).toBe("object");
    expect(tool.parameters.properties.type.enum).toEqual(["dispatch", "respond"]);
    expect(tool.parameters.required).toEqual(["type"]);
  });

  it("respond 缺少字段或分支字段时 fail-closed", async () => {
    const { tool } = register();
    const missing = await tool.execute("call", { type: "respond" }, undefined, undefined, context());
    expect(missing.isError).toBe(true);
    expect(missing.content[0].text).toContain("respond 需要");
    const invalid = await tool.execute("call", { type: "respond", workerId: "w", requestId: "r", response: { type: "provide_context" } }, undefined, undefined, context());
    expect(invalid.isError).toBe(true);
    expect(invalid.content[0].text).toContain("response 字段不符合");
  });
});
