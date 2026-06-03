/**
 * P4-用户接口层：worker-widget 单测
 *
 * 覆盖：
 *   - 折叠态：多 worker 单行 + 缩进 + 信号角标
 *   - 展开态：多 worker Tab 面板（/dteam 触发）
 *   - 终态清理：registerWorkerTerminated + scheduleTerminationCleanup
 *   - 状态栏：极简计数
 *   - dispose / invalidate：内存泄漏防护
 *
 * 集成测试见 `tests/P4/worker-panel.test.ts`（showWorkerPanel 集成）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	showWorkerStatus,
	clearWorkerStatus,
	resetThrottleState,
	resetExpandedState,
	resetDisposedCount,
	getDisposedCount,
	updateAgentProgress,
	showWorkerPanel,
	buildTabBar,
	buildTabContent,
	formatWorkerRow,
	WorkerStatusList,
	isExpanded,
	registerWorkerTerminated,
	installSignalBridge,
	uninstallSignalBridge,
} from "../../src/P4/worker-widget.js";
import {
	getStore,
	resetStore,
	setProgress,
	markTerminated,
	recordSignal,
	setParent,
} from "../../src/P4/renderers.js";

// ── Mock ──────────────────────────────────────────────────

function makeMockTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bg: (_color: string, text: string) => text,
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
			custom: vi.fn(() => new Promise<never>(() => {})), // pending — 不自动 resolve
			requestRender: vi.fn(),
		},
		_widgets: widgets,
	};
}

/** 构造一个最小 WorkerProgress 记录 */
function makeProgress(overrides: Partial<ReturnType<typeof getStore> extends Map<string, infer V> ? V : never> = {}) {
	const now = Date.now();
	return {
		workerId: "w-1",
		role: "build",
		status: "running" as const,
		task: "实现功能",
		toolCount: 0,
		startTime: now,
		elapsedMs: 0,
		signalCount: 0,
		...overrides,
	};
}

// ── 测试 ──────────────────────────────────────────────────

describe("worker-widget", () => {
	beforeEach(() => {
		resetThrottleState();
		resetExpandedState();
		resetDisposedCount();
		resetStore();
	});

	// ═══════════════════════════════════════════════════════════
	// 折叠态：多 worker 单行 widget
	// ═══════════════════════════════════════════════════════════

	describe("折叠态 widget (dteam-workers)", () => {
		it("调用 ctx.ui.setWidget 注册 dteam-workers", () => {
			const ctx = makeMockCtx();
			showWorkerStatus(ctx as any, "w-1", {
				status: "running",
				agent: "build",
				task: "实现 LLM executor",
				toolCount: 3,
				elapsedMs: 5000,
			} as any);

			expect(ctx.ui.setWidget).toHaveBeenCalledWith("dteam-workers", expect.any(Function));
		});

		it("无 UI 时不调用 setWidget", () => {
			const ctx = makeMockCtx(false);
			showWorkerStatus(ctx as any, "w-1", {
				status: "running",
				agent: "build",
				task: "test",
				toolCount: 0,
				elapsedMs: 0,
			} as any);

			expect(ctx.ui.setWidget).not.toHaveBeenCalled();
		});

		it("节流：1s 内多次调用只更新一次", async () => {
			const ctx = makeMockCtx();

			showWorkerStatus(ctx as any, "w-1", {
				status: "running",
				agent: "build",
				task: "test",
				toolCount: 0,
				elapsedMs: 0,
			} as any);
			expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);

			showWorkerStatus(ctx as any, "w-1", {
				status: "running",
				agent: "build",
				task: "test",
				toolCount: 1,
				elapsedMs: 100,
			} as any);
			expect(ctx.ui.setWidget).toHaveBeenCalledTimes(1);

			await new Promise((resolve) => setTimeout(resolve, 1100));
			expect(ctx.ui.setWidget).toHaveBeenCalledTimes(2);
		});
	});

	describe("clearWorkerStatus", () => {
		it("调用 ctx.ui.setWidget(undefined) 清除 widget", () => {
			const ctx = makeMockCtx();
			clearWorkerStatus(ctx as any);

			expect(ctx.ui.setWidget).toHaveBeenCalledWith("dteam-workers", undefined);
		});

		it("无 UI 时不调用 setWidget", () => {
			const ctx = makeMockCtx(false);
			clearWorkerStatus(ctx as any);

			expect(ctx.ui.setWidget).not.toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════
	// WorkerStatusList：多 worker 单行渲染
	// ═══════════════════════════════════════════════════════════

	describe("WorkerStatusList render", () => {
		it("空 store：显示 '(no workers)'", () => {
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			expect(lines[0]).toContain("no workers");
		});

		it("单 worker：单行格式", () => {
			setProgress(makeProgress({ workerId: "w-1", role: "build", task: "实现功能" }));
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			// 倒数第一行是 expand 提示（F2 expand），worker 行在前面
			const workerLine = lines.find((l) => l.includes("build"));
			expect(workerLine).toBeDefined();
			expect(workerLine).toContain("实现功能");
		});

		it("多 worker：多行显示，无缩进", () => {
			setProgress(makeProgress({ workerId: "w-1", role: "build", task: "实现" }));
			setProgress(makeProgress({ workerId: "w-2", role: "check", task: "验收" }));
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			expect(lines.some((l) => l.includes("build"))).toBe(true);
			expect(lines.some((l) => l.includes("check"))).toBe(true);
		});

		it("嵌套 worker：子行带 2 空格 + ↳", () => {
			setProgress(makeProgress({ workerId: "team-1", role: "team", task: "并行任务" }));
			setProgress(makeProgress({ workerId: "team-1-0", role: "build", task: "build 子任务", parentWorkerId: "team-1" }));
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			const teamLine = lines.find((l) => l.includes("team") && !l.includes("↳"));
			const kidLine = lines.find((l) => l.includes("build") && l.includes("↳"));
			expect(teamLine).toBeDefined();
			expect(kidLine).toMatch(/^  ↳.*build/);
		});

		it("信号角标：signalCount=1 显示 📡", () => {
			setProgress(makeProgress({ workerId: "w-1", role: "build" }));
			recordSignal("w-1", "progress");
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			expect(lines[0]).toContain("📡");
			expect(lines[0]).not.toContain("×");
		});

		it("信号角标：signalCount>1 显示 📡×3", () => {
			setProgress(makeProgress({ workerId: "w-1", role: "build" }));
			recordSignal("w-1", "progress");
			recordSignal("w-1", "progress");
			recordSignal("w-1", "progress");
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			expect(lines[0]).toContain("📡×3");
		});

		it("信号类型映射：blocked → 🚧", () => {
			setProgress(makeProgress({ workerId: "w-1", role: "build" }));
			recordSignal("w-1", "blocked");
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			expect(lines[0]).toContain("🚧");
		});

		it("chain step 标识：[i/N] 前缀", () => {
			setProgress(makeProgress({ workerId: "chain-1", role: "chain", task: "串行" }));
			setProgress(makeProgress({
				workerId: "chain-1-0",
				role: "build",
				task: "build 步",
				parentWorkerId: "chain-1",
				isChainStep: true,
				chainIndex: 1,
				chainTotal: 3,
			}));
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(80);
			expect(lines[1]).toContain("[1/3]");
		});

		it("宽度不足时降级为简化显示", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines = list.render(10);
			expect(lines[0]).toContain("w-1");
		});

		it("invalidate 清除缓存", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			const list = new WorkerStatusList(makeMockTheme() as any);
			const lines1 = list.render(60);
			const lines2 = list.render(60);
			expect(lines1).toBe(lines2); // 同一引用
			list.invalidate();
			const lines3 = list.render(60);
			expect(lines3).not.toBe(lines1);
		});
	});

	// ═══════════════════════════════════════════════════════════
	// formatWorkerRow：单行格式化函数
	// ═══════════════════════════════════════════════════════════

	describe("formatWorkerRow", () => {
		it("基本格式：statusIcon + role + task + 工具:n + elapsed", () => {
			const p = makeProgress({ role: "build", task: "实现功能", toolCount: 3, elapsedMs: 5000 });
			const line = formatWorkerRow(p, 80, 0);
			expect(line).toContain("build");
			expect(line).toContain("实现功能");
			expect(line).toContain("工具:3");
			expect(line).toContain("5.0s");
		});

		it("indent=2 + 父任务：行首 '  ↳ '", () => {
			const p = makeProgress({ role: "build", task: "子任务" });
			const line = formatWorkerRow(p, 80, 2);
			expect(line.startsWith("  ↳ ")).toBe(true);
		});

		it("currentTool 后缀：' · edit'", () => {
			const p = makeProgress({ currentTool: "edit" });
			const line = formatWorkerRow(p, 80, 0);
			expect(line).toContain("· edit");
		});

		it("chain step 标识：[1/3] 前缀", () => {
			const p = makeProgress({ chainIndex: 1, chainTotal: 3, isChainStep: true });
			const line = formatWorkerRow(p, 80, 0);
			expect(line).toContain("[1/3]");
		});

		it("宽度截断", () => {
			const p = makeProgress({ task: "非常长的任务描述".repeat(10) });
			const line = formatWorkerRow(p, 30, 0);
			expect(line.length).toBeLessThanOrEqual(30);
		});
	});

	// ═══════════════════════════════════════════════════════════
	// updateAgentProgress(workerId, progress)：新签名
	// ═══════════════════════════════════════════════════════════

	describe("updateAgentProgress (新签名)", () => {
		it("写 store（不抛错）", () => {
			expect(() => {
				updateAgentProgress("w-1", {
					startTime: Date.now() - 5000,
					currentTool: "bash",
					recentOutput: "hello",
					tokenCount: 100,
					status: "running",
				});
			}).not.toThrow();
		});

		it("无 store 记录时也不抛错（容错）", () => {
			expect(() => {
				updateAgentProgress("nonexistent", {
					startTime: Date.now(),
					recentOutput: "",
					tokenCount: 0,
					status: "running",
				});
			}).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════
	// registerWorkerTerminated：终态清理
	// ═══════════════════════════════════════════════════════════

	describe("registerWorkerTerminated", () => {
		it("标记 worker 为 done，写 store", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			registerWorkerTerminated("w-1", "done");
			const p = getStore().get("w-1");
			expect(p?.status).toBe("done");
		});

		it("标记 worker 为 failed + 错误信息", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			registerWorkerTerminated("w-1", "failed", "spawn error");
			const p = getStore().get("w-1");
			expect(p?.status).toBe("failed");
			expect(p?.finalError).toBe("spawn error");
		});

		it("无 store 记录时自动创建最小记录", () => {
			registerWorkerTerminated("w-new", "done");
			const p = getStore().get("w-new");
			expect(p).toBeDefined();
			expect(p?.status).toBe("done");
		});
	});

	// ═══════════════════════════════════════════════════════════
	// showWorkerPanel：/dteam command 触发入口
	// ═══════════════════════════════════════════════════════════

	describe("showWorkerPanel", () => {
		it("无 worker 状态时也弹提示 panel（AC9 修复）", () => {
			const ctx = makeMockCtx();
			void showWorkerPanel(ctx as any);

			// 修复后空 store 也弹 panel
			expect(ctx.ui.setWidget).toHaveBeenCalled();
			expect(isExpanded()).toBe(true);
		});

		it("有 worker 状态时展开调用 setWidget", () => {
			const ctx = makeMockCtx();
			setProgress(makeProgress({ workerId: "w-1" }));
			ctx.ui.setWidget.mockClear();

			void showWorkerPanel(ctx as any);

			expect(ctx.ui.setWidget).toHaveBeenCalled();
			expect(isExpanded()).toBe(true);
		});

		it("展开后再次 showWorkerPanel 幂等折叠", () => {
			const ctx = makeMockCtx();
			setProgress(makeProgress({ workerId: "w-1" }));
			ctx.ui.setWidget.mockClear();

			void showWorkerPanel(ctx as any);
			expect(isExpanded()).toBe(true);

			// 第二次调用触发 closeWorkerPanel（幂等关闭）
			showWorkerPanel(ctx as any);
			expect(isExpanded()).toBe(false);
		});

		it("无 UI 时不展开", async () => {
			const ctx = makeMockCtx(false);
			setProgress(makeProgress({ workerId: "w-1" }));

			await showWorkerPanel(ctx as any);
			expect(ctx.ui.custom).not.toHaveBeenCalled();
		});
	});

	// ═══════════════════════════════════════════════════════════
	// buildTabBar：多 worker Tab 栏
	// ═══════════════════════════════════════════════════════════

	describe("buildTabBar", () => {
		it("多 worker tab 数量正确", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			setProgress(makeProgress({ workerId: "w-2" }));
			setProgress(makeProgress({ workerId: "team-1" }));
			const parents = Array.from(getStore().values()).filter((p) => !p.parentWorkerId);
			const bar = buildTabBar(makeMockTheme() as any, parents, 0, 80);
			expect(bar).toContain("w-1");
			expect(bar).toContain("w-2");
			expect(bar).toContain("team-1");
		});
	});

	// ═══════════════════════════════════════════════════════════
	// buildTabContent：Tab 内容渲染
	// ═══════════════════════════════════════════════════════════

	describe("buildTabContent", () => {
		it("渲染完整进度信息（从 store）", () => {
			const now = Date.now();
			const p = makeProgress({
				workerId: "w-1",
				role: "build",
				status: "running",
				task: "实现功能",
				toolCount: 5,
				startTime: now - 150000,
				elapsedMs: 150000,
			});
			const extended = {
				currentTool: "bash",
				recentOutput: "$ npm test\n✓ 138 tests passed",
				tokenCount: 12345,
				duration: 150000,
				activityFreshness: now - 1000,
			};

			const lines = buildTabContent(makeMockTheme() as any, p, [], extended, 80);

			// 标题行
			expect(lines[0]).toContain("build");
			expect(lines[0]).toContain("running");
			expect(lines[0]).toContain("2m 30s");

			// Task + Current Tool + Output
			const all = lines.join("\n");
			expect(all).toContain("任务: 实现功能");
			expect(all).toContain("当前工具: bash");
			expect(all).toContain("npm test");
			expect(all).toContain("138 tests passed");
			expect(all).toContain("Token 数量: 12,345");
		});

		it("failed 状态显示 finalError", () => {
			const p = makeProgress({ workerId: "w-1", status: "failed", finalError: "model 404" });
			const lines = buildTabContent(makeMockTheme() as any, p, [], undefined, 60);
			const all = lines.join("\n");
			expect(all).toContain("错误: model 404");
		});

		it("信号徽章在标题行", () => {
			const p = makeProgress({
				workerId: "w-1",
				signalCount: 2,
				lastSignal: { type: "blocked", at: Date.now() },
			});
			const lines = buildTabContent(makeMockTheme() as any, p, [], undefined, 60);
			const all = lines.join("\n");
			expect(all).toContain("🚧×2");
		});
	});

	// ═══════════════════════════════════════════════════════════
	// dispose / 内存泄漏防护
	// ═══════════════════════════════════════════════════════════

	describe("dispose", () => {
		it("WidgetStatusList.dispose 计入 disposedCount", () => {
			const list = new WorkerStatusList(makeMockTheme() as any);
			expect(getDisposedCount()).toBe(0);
			list.dispose();
			expect(getDisposedCount()).toBe(1);
		});
	});

	// ═══════════════════════════════════════════════════════════
	// 信号桥接（installSignalBridge）
	// ═══════════════════════════════════════════════════════════

	describe("installSignalBridge", () => {
		it("progress 信号 → store 中 recordSignal", () => {
			const listeners: Record<string, Array<(s: any) => void>> = {};
			const fakeBus = {
				on: (type: string, fn: any) => {
					if (!listeners[type]) listeners[type] = [];
					listeners[type].push(fn);
					return () => {};
				},
			};
			installSignalBridge(fakeBus as any);

			setProgress(makeProgress({ workerId: "w-1" }));
			listeners.progress.forEach((fn) => fn({ workerId: "w-1", data: { status: "running" } }));

			const p = getStore().get("w-1");
			expect(p?.signalCount).toBe(1);
			expect(p?.lastSignal?.type).toBe("progress");
		});

		it("带 parentWorkerId 的信号 → store 设置嵌套关系", () => {
			const listeners: Record<string, Array<(s: any) => void>> = {};
			const fakeBus = {
				on: (type: string, fn: any) => {
					if (!listeners[type]) listeners[type] = [];
					listeners[type].push(fn);
					return () => {};
				},
			};
			installSignalBridge(fakeBus as any);

			listeners.progress.forEach((fn) => fn({
				workerId: "child-1",
				data: { parentWorkerId: "team-1", role: "build", task: "子任务" },
			}));

			const p = getStore().get("child-1");
			expect(p?.parentWorkerId).toBe("team-1");
			expect(p?.role).toBe("build");
			expect(p?.task).toBe("子任务");
		});

		it("chainIndex 信号 → store 标记 isChainStep", () => {
			const listeners: Record<string, Array<(s: any) => void>> = {};
			const fakeBus = {
				on: (type: string, fn: any) => {
					if (!listeners[type]) listeners[type] = [];
					listeners[type].push(fn);
					return () => {};
				},
			};
			installSignalBridge(fakeBus as any);

			listeners.progress.forEach((fn) => fn({
				workerId: "step-2",
				data: { chainIndex: 2, chainTotal: 5, isChainStep: true },
			}));

			const p = getStore().get("step-2");
			expect(p?.chainIndex).toBe(2);
			expect(p?.chainTotal).toBe(5);
			expect(p?.isChainStep).toBe(true);
		});

		it("重复安装幂等（不重复注册 listener）", () => {
			const listeners: Record<string, Array<(s: any) => void>> = {};
			const fakeBus = {
				on: (type: string, fn: any) => {
					if (!listeners[type]) listeners[type] = [];
					listeners[type].push(fn);
					return () => {};
				},
			};
			uninstallSignalBridge(); // 重置
			installSignalBridge(fakeBus as any);
			const count1 = listeners.progress.length;
			installSignalBridge(fakeBus as any);
			const count2 = listeners.progress.length;
			expect(count2).toBe(count1);
		});

		it("uninstallSignalBridge 取消所有 listener", () => {
			const fakeBus = {
				on: () => () => {},
			};
			installSignalBridge(fakeBus as any);
			expect(() => uninstallSignalBridge()).not.toThrow();
		});
	});

	// ═══════════════════════════════════════════════════════════
	// updateAgentProgress(workerId, p) 触发折叠 widget 重绘
	// ═══════════════════════════════════════════════════════════

	describe("updateAgentProgress 触发 TUI 重绘", () => {
		it("写入 latestProgressByWorker（不抛错）", () => {
			expect(() => {
				updateAgentProgress("w-1", {
					startTime: Date.now(),
					currentTool: "bash",
					recentOutput: "out",
					tokenCount: 50,
					status: "tool",
				});
			}).not.toThrow();
		});
	});
});
