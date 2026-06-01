/**
 * P4-用户接口层：worker-widget 单测（折叠态 + 展开态）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	showWorkerStatus,
	clearWorkerStatus,
	resetThrottleState,
	resetExpandedState,
	isExpanded,
	updateAgentProgress,
	toggleWorkerExpanded,
	WorkerFullscreenView,
} from "../../src/P4/worker-widget.js";

// ── Mock ──────────────────────────────────────────────────

function makeMockTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
	};
}

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
			custom: vi.fn(() => Promise.resolve(undefined)),
			requestRender: vi.fn(),
		},
		_widgets: widgets,
	};
}

// ── 测试 ──────────────────────────────────────────────────

describe("worker-widget", () => {
	beforeEach(() => {
		resetThrottleState();
		resetExpandedState();
	});

	describe("showWorkerStatus (折叠态)", () => {
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

	describe("WorkerStatusBox render (折叠态)", () => {
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
			const mockTheme = makeMockTheme();
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
			const mockTheme = makeMockTheme();
			const component = factory(null, mockTheme);
			const lines = component.render(10); // 宽度不足

			expect(lines.length).toBe(1);
			expect(lines[0]).toContain("worker");
		});
	});

	describe("updateAgentProgress", () => {
		it("更新 latestProgress 数据", () => {
			const now = Date.now();
			updateAgentProgress({
				startTime: now - 5000,
				currentTool: "bash",
				recentOutput: "hello\nworld",
				tokenCount: 1234,
				status: "running",
			});

			// isExpanded 为 false，但数据应该已存储
			expect(isExpanded()).toBe(false);
		});
	});

	describe("toggleWorkerExpanded", () => {
		it("无 worker 状态时不展开", () => {
			const ctx = makeMockCtx();
			toggleWorkerExpanded(ctx as any);

			expect(ctx.ui.custom).not.toHaveBeenCalled();
			expect(isExpanded()).toBe(false);
		});

		it("有 worker 状态时展开调用 custom", () => {
			const ctx = makeMockCtx();
			// 先设置 worker 状态
			showWorkerStatus(ctx as any, {
				status: "running",
				agent: "build",
				task: "test",
				toolCount: 0,
				elapsedMs: 0,
			});
			// 重置 mock 计数
			ctx.ui.setWidget.mockClear();
			ctx.ui.custom.mockClear();

			toggleWorkerExpanded(ctx as any);

			// 应该移除折叠 widget 并弹出 overlay
			expect(ctx.ui.setWidget).toHaveBeenCalledWith("dteam-worker", undefined);
			expect(ctx.ui.custom).toHaveBeenCalled();
			expect(isExpanded()).toBe(true);
		});

		it("展开后再次 toggle 折叠", () => {
			const ctx = makeMockCtx();
			// 先设置 worker 状态
			showWorkerStatus(ctx as any, {
				status: "running",
				agent: "build",
				task: "test",
				toolCount: 0,
				elapsedMs: 0,
			});
			ctx.ui.setWidget.mockClear();

			// 展开
			toggleWorkerExpanded(ctx as any);
			expect(isExpanded()).toBe(true);

			// 再次 toggle 折叠
			toggleWorkerExpanded(ctx as any);
			expect(isExpanded()).toBe(false);
			// 应该恢复折叠 widget
			expect(ctx.ui.setWidget).toHaveBeenCalledWith("dteam-worker", expect.any(Function));
		});

		it("无 UI 时不展开", () => {
			const ctx = makeMockCtx(false);
			// 先设置 worker 状态
			showWorkerStatus(ctx as any, {
				status: "running",
				agent: "build",
				task: "test",
				toolCount: 0,
				elapsedMs: 0,
			});

			toggleWorkerExpanded(ctx as any);
			expect(ctx.ui.custom).not.toHaveBeenCalled();
		});
	});

	describe("WorkerFullscreenView render (展开态)", () => {
		it("渲染完整进度信息", () => {
			const theme = makeMockTheme();
			const now = Date.now();
			const view = new WorkerFullscreenView(
				theme,
				{
					status: "running",
					agent: "build",
					task: "实现功能",
					toolCount: 5,
					currentTool: "bash",
					elapsedMs: 150000,
				},
				{
					currentTool: "bash",
					recentOutput: "$ npm test\n✓ 138 tests passed",
					tokenCount: 12345,
					duration: 150000,
					activityFreshness: now - 5000,
					currentToolDuration: 15000,
				},
			);

			const lines = view.render(80);

			// 标题行
			expect(lines[0]).toContain("Worker: build");
			expect(lines[0]).toContain("running");
			expect(lines[0]).toContain("2m 30s");

			// Task
			expect(lines[2]).toContain("Task: 实现功能");

			// Current Tool
			expect(lines[4]).toContain("Current Tool: bash");
			expect(lines[4]).toContain("15s");

			// Recent Output
			expect(lines[6]).toContain("Recent Output (5 tools):");
			expect(lines[7]).toContain("npm test");
			expect(lines[8]).toContain("138 tests passed");

			// Token Count
			expect(lines[10]).toContain("Token Count: 12,345");

			// Activity
			expect(lines[11]).toContain("Activity: 5s ago");

			// 底部提示
			expect(lines[lines.length - 1]).toContain("[Ctrl+O] collapse");
		});

		it("无 progress 时渲染默认值", () => {
			const theme = makeMockTheme();
			const view = new WorkerFullscreenView(
				theme,
				{
					status: "pending",
					agent: "explore",
					task: "分析代码",
					toolCount: 0,
					elapsedMs: 0,
				},
				null,
			);

			const lines = view.render(60);
			const all = lines.join("\n");

			expect(all).toContain("Worker: explore");
			expect(all).toContain("pending");
			expect(all).toContain("Current Tool: (none)");
			expect(all).toContain("(no output yet)");
			expect(all).toContain("Token Count: —");
		});

		it("invalidate 清除缓存", () => {
			const theme = makeMockTheme();
			const view = new WorkerFullscreenView(
				theme,
				{ status: "running", agent: "build", task: "test", toolCount: 0, elapsedMs: 0 },
				null,
			);

			const lines1 = view.render(60);
			// 缓存命中
			const lines2 = view.render(60);
			expect(lines1).toBe(lines2); // 同一引用

			// invalidate 后重新渲染
			view.invalidate();
			const lines3 = view.render(60);
			expect(lines3).not.toBe(lines1); // 不同引用（新数组）
		});

		it("updateData 更新数据", () => {
			const theme = makeMockTheme();
			const view = new WorkerFullscreenView(
				theme,
				{ status: "running", agent: "build", task: "test", toolCount: 0, elapsedMs: 0 },
				null,
			);

			view.render(60);

			// 更新数据
			view.updateData(
				{ status: "done", agent: "build", task: "test", toolCount: 3, elapsedMs: 10000 },
				{ duration: 10000, activityFreshness: Date.now(), tokenCount: 500 },
			);

			const lines = view.render(60);
			const all = lines.join("\n");
			expect(all).toContain("done");
			expect(all).toContain("Token Count: 500");
		});
	});
});
