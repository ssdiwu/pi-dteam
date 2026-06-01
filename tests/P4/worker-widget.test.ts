/**
 * P4-用户接口层：worker-widget 单测
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { showWorkerStatus, clearWorkerStatus, resetThrottleState } from "../../src/P4/worker-widget.js";

// ── Mock ──────────────────────────────────────────────────

function makeMockCtx(hasUI = true) {
  const widgets = new Map<string, any>();
  return {
    hasUI,
    ui: {
      setWidget: vi.fn((key: string, factory: any) => {
        widgets.set(key, factory);
      }),
      notify: vi.fn(),
      setStatus: vi.fn(),
    },
    _widgets: widgets,
  };
}

// ── 测试 ──────────────────────────────────────────────────

describe("worker-widget", () => {
	beforeEach(() => {
		resetThrottleState();
	});
  describe("showWorkerStatus", () => {
    it("调用 ctx.ui.setWidget 注册 widget", () => {
      const ctx = makeMockCtx();
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "实现 LLM executor",
        toolCount: 3,
        elapsedMs: 5000,
      });

      expect(ctx.ui.setWidget).toHaveBeenCalledWith("dteam-worker", expect.any(Function));
    });

    it("无 UI 时不调用 setWidget", () => {
      const ctx = makeMockCtx(false);
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "test",
        toolCount: 0,
        elapsedMs: 0,
      });

      expect(ctx.ui.setWidget).not.toHaveBeenCalled();
    });

    it("节流：1s 内多次调用只更新一次", async () => {
      const ctx = makeMockCtx();

      // 第一次调用（立即更新）
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "test",
        toolCount: 0,
        elapsedMs: 0,
      });
      expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);

      // 第二次调用（立即调用，触发节流）
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "test",
        toolCount: 1,
        elapsedMs: 100,
      });
      // 仍然只有 1 次（被节流）
      expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);

      // 等待 1s，节流触发
      await new Promise((resolve) => setTimeout(resolve, 1100));
      expect(ctx.ui.setWidget).toHaveBeenCalledTimes(2);
    });
  });

  describe("clearWorkerStatus", () => {
    it("调用 ctx.ui.setWidget(undefined) 清除 widget", () => {
      const ctx = makeMockCtx();
      clearWorkerStatus(ctx as any);

      expect(ctx.ui.setWidget).toHaveBeenCalledWith("dteam-worker", undefined);
    });

    it("无 UI 时不调用 setWidget", () => {
      const ctx = makeMockCtx(false);
      clearWorkerStatus(ctx as any);

      expect(ctx.ui.setWidget).not.toHaveBeenCalled();
    });

    it("清除节流定时器", async () => {
      const ctx = makeMockCtx();

      // 先触发节流
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "test",
        toolCount: 0,
        elapsedMs: 0,
      });
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "test",
        toolCount: 1,
        elapsedMs: 100,
      });

      // 清除
      clearWorkerStatus(ctx as any);

      // 等待 1s，不应该触发更新
      await new Promise((resolve) => setTimeout(resolve, 1100));

      // 只有第一次立即更新 + clearWorkerStatus 的 undefined
      expect(ctx.ui.setWidget).toHaveBeenCalledTimes(2);
    });
  });

  describe("WorkerStatusBox render", () => {
    it("渲染 bordered box", () => {
      const ctx = makeMockCtx();
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "实现 LLM executor",
        toolCount: 3,
        currentTool: "edit",
        elapsedMs: 12300,
      });

      // 获取 factory 函数
      const factory = ctx.ui.setWidget.mock.calls[0][1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
        bold: (text: string) => text,
        italic: (text: string) => text,
        underline: (text: string) => text,
      };
      const component = factory(null, mockTheme);
      const lines = component.render(60);

      // 验证结构
      expect(lines.length).toBe(6); // top + 4 content + bottom
      expect(lines[0]).toContain("╭");
      expect(lines[0]).toContain("worker");
      expect(lines[0]).toContain("running");
      expect(lines[1]).toContain("Agent: build");
      expect(lines[2]).toContain("Task: 实现 LLM executor");
      expect(lines[3]).toContain("Tools: 3 (current: edit)");
      expect(lines[4]).toContain("Elapsed: 12.3s");
      expect(lines[5]).toContain("╰");
    });

    it("宽度不足时降级为单行", () => {
      const ctx = makeMockCtx();
      showWorkerStatus(ctx as any, {
        status: "running",
        agent: "build",
        task: "test",
        toolCount: 0,
        elapsedMs: 0,
      });

      const factory = ctx.ui.setWidget.mock.calls[0][1];
      const mockTheme = {
        fg: (color: string, text: string) => text,
        bold: (text: string) => text,
        italic: (text: string) => text,
        underline: (text: string) => text,
      };
      const component = factory(null, mockTheme);
      const lines = component.render(10); // 宽度不足

      expect(lines.length).toBe(1);
      expect(lines[0]).toContain("worker");
    });
  });
});
