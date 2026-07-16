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
    on: vi.fn(), registerTool: vi.fn(), registerCommand: vi.fn(), sendMessage: vi.fn(),
    getActiveTools: vi.fn(() => ["read", "grep", "find", "ls", "bash", "edit", "write"]),
  };
  registerDteam(pi as any);
  const tools = Object.fromEntries(pi.registerTool.mock.calls.map(([tool]: any[]) => [tool.name, tool]));
  return { pi, tools, command: pi.registerCommand.mock.calls[0][1] };
}

function context() {
  return {
    cwd: "/workspace", model: { provider: "ctx", id: "model" },
    modelRegistry: { authStorage: {}, find: vi.fn(() => ({ provider: "ctx", id: "model" })) },
    ui: { setStatus: vi.fn(), notify: vi.fn() },
  };
}

describe("dteam next-major extension entry", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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
  });

  it("工具描述表达分级、报告、交接、写入守卫和显式等待", () => {
    const { tools } = register();
    expect(tools.dteam_dispatch.description).toContain("dteam_report");
    expect(tools.dteam_dispatch.description).toContain("writeScope");
    expect(tools.dteam_respond.description).toContain("普通阻塞");
    expect(tools.dteam_recover.description).toContain("timeout recovery");
    expect(tools.dteam_wait.description).toContain("依赖指定 worker");
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

  it("worker 内部事件不直接展示到主对话且会脱敏", () => {
    const pi = { sendMessage: vi.fn() };
    sendParentEvent(pi as any, { type: "failed", workerId: "w", title: "api_key=sk-title-secret", payload: { result: "api_key=sk-12345678901234567890 DATABASE_URL=postgresql://u:pw@example.test/db" } } as any);
    const message = pi.sendMessage.mock.calls[0]?.[0];
    expect(message).toMatchObject({ customType: "dteam-worker", display: false });
    expect(JSON.stringify(message)).not.toContain("sk-title-secret");
    expect(JSON.stringify(message)).not.toContain("postgresql://u:pw@example.test/db");
  });
});
