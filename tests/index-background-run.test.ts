/**
 * index-background-run.test.ts
 *
 * 验证 dteam 后台 run 不再依赖 onUpdate，避免在工具返回后继续发 partial update。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const mockRun = vi.fn();

vi.mock("../src/orchestrator.js", () => ({
  run: mockRun,
}));

function createPiMock() {
  let toolDef: any;
  return {
    toolDef: () => toolDef,
    api: {
      registerTool: vi.fn((def) => {
        toolDef = def;
      }),
      registerCommand: vi.fn(),
      registerMessageRenderer: vi.fn(),
      sendMessage: vi.fn(),
    },
  };
}

function createCtx() {
  return {
    model: { provider: "minimax-cn", id: "MiniMax-M3" },
    modelRegistry: { find: () => ({ provider: "minimax-cn", id: "MiniMax-M3" }), authStorage: {}, getAll: () => [] },
    cwd: "/tmp",
    hasUI: true,
    ui: {
      notify: vi.fn(),
      setStatus: vi.fn(),
      setWidget: vi.fn(),
    },
  } as any;
}

describe("index 后台 run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("action=run 立即返回后，后台执行不调用 onUpdate", async () => {
    const { api, toolDef } = createPiMock();
    const mod = await import("../index.ts");
    mod.default(api as any);

    const tool = toolDef();
    expect(tool).toBeDefined();

    let resolveRun: ((value: any) => void) | null = null;
    mockRun.mockReturnValue(new Promise((resolve) => {
      resolveRun = resolve;
    }));

    const onUpdate = vi.fn();
    const ctx = createCtx();

    const result = await tool.execute(
      "tool-1",
      { action: "run", goal: "后台任务测试" },
      undefined,
      onUpdate,
      ctx,
    );

    expect(result.content[0].text).toContain('"status":"running"');
    expect(onUpdate).not.toHaveBeenCalled();

    resolveRun?.({
      status: "done",
      goal: "后台任务测试",
      plan: { mode: "solo", reason: "测试", steps: [] },
      steps: [],
      summary: "0/0 完成",
    });

    await Promise.resolve();
    await new Promise((r) => setTimeout(r, 0));

    expect(onUpdate).not.toHaveBeenCalled();
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
