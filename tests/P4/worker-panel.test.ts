/**
 * Worker Panel 集成测试（showWorkerPanel）
 *
 * 覆盖 check agent 发现的 2 个 BUG + AC6 (Esc/q 关闭) + 异常分支 Esc 死锁
 * + dispose 路径资源清理 + 纯函数（buildTabBar / buildTabContent / formatNestedWorkers）。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	showWorkerPanel,
	buildTabBar,
	buildTabContent,
	formatNestedWorkers,
	resetExpandedState,
	resetThrottleState,
	resetDisposedCount,
} from "../../src/P4/worker-widget.js";
import {
	getStore,
	resetStore,
	setProgress,
	setParent,
} from "../../src/P4/renderers.js";

// ── Helpers ─────────────────────────────────────────────

function makeMockTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
	};
}

/** Mock TUI 引用（提供 requestRender） */
function makeMockTui() {
	return { requestRender: vi.fn() };
}

interface CapturedPanel {
	render: (width: number) => string[];
	invalidate: () => void;
	handleInput: (data: string) => void;
	dispose: () => void;
	donePromise: Promise<unknown>;
}

/** Mock ctx.ui.custom 实际跑 factory 并捕获 handleInput / dispose / done */
function makeCapturingCtx() {
	let captured: CapturedPanel | null = null;
	const ctx = {
		hasUI: true,
		ui: {
			setWidget: vi.fn((_key: string, factory: any) => {
				if (typeof factory === "function") {
					try {
						factory(makeMockTui(), makeMockTheme());
					} catch {
						/* expected during cleanup */
					}
				}
			}),
			setStatus: vi.fn(),
			notify: vi.fn(),
			requestRender: vi.fn(),
			custom: vi.fn((factory: any) => {
				let resolveDone!: (value: unknown) => void;
				const donePromise = new Promise<unknown>((res) => {
					resolveDone = res;
				});
				const tui = makeMockTui();
				const component = factory(tui, makeMockTheme(), null, resolveDone);
				captured = {
					render: (w) => component.render(w),
					invalidate: () => component.invalidate?.(),
					handleInput: (data) => component.handleInput?.(data),
					dispose: () => component.dispose?.(),
					donePromise,
				};
				return donePromise;
			}),
		},
	};
	return { ctx, getCaptured: () => captured };
}

function makeWorkerProgress(over: Partial<{
	workerId: string;
	role: string;
	status: "pending" | "running" | "done" | "failed";
	task: string;
	toolCount: number;
	startTime: number;
	elapsedMs: number;
	signalCount: number;
	parentWorkerId: string;
}> = {}) {
	return {
		workerId: over.workerId ?? "w-1",
		role: over.role ?? "build",
		status: over.status ?? "running",
		task: over.task ?? "task",
		toolCount: over.toolCount ?? 0,
		startTime: over.startTime ?? Date.now(),
		elapsedMs: over.elapsedMs ?? 0,
		signalCount: over.signalCount ?? 0,
		...(over.parentWorkerId ? { parentWorkerId: over.parentWorkerId } : {}),
	};
}

// ── 集成测试 ───────────────────────────────────────────

describe("showWorkerPanel (集成)", () => {
	beforeEach(() => {
		resetStore();
		resetThrottleState();
		resetExpandedState();
		resetDisposedCount();
	});

	it("store 空时直接 return（不弹 panel）", () => {
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		expect(ctx.ui.custom).not.toHaveBeenCalled();
		expect(getCaptured()).toBeNull();
	});

	it("只有子 worker（无 parent）时弹异常分支 panel", () => {
		setProgress(makeWorkerProgress({ workerId: "child-1", parentWorkerId: "parent-missing" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured();
		expect(panel).not.toBeNull();
		const lines = panel!.render(80);
		expect(lines.join("\n")).toContain("no parent workers");
	});

	it("异常分支 Esc 关掉 overlay（BUG #2 修复验证）", () => {
		setProgress(makeWorkerProgress({ workerId: "child-1", parentWorkerId: "parent-missing" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		panel.handleInput("\x1b"); // Esc
		return panel.donePromise.then((result) => {
			expect(result).toBeNull();
		});
	});

	it("异常分支 q 关掉 overlay", () => {
		setProgress(makeWorkerProgress({ workerId: "child-1", parentWorkerId: "parent-missing" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		panel.handleInput("q");
		return panel.donePromise.then((result) => {
			expect(result).toBeNull();
		});
	});

	it("异常分支 Ctrl+C 关掉 overlay", () => {
		setProgress(makeWorkerProgress({ workerId: "child-1", parentWorkerId: "parent-missing" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		panel.handleInput("\x03"); // Ctrl+C
		return panel.donePromise.then((result) => {
			expect(result).toBeNull();
		});
	});

	it("正常 worker 弹 panel + 渲染 tab 栏", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1", role: "build", task: "实现功能" }));
		setProgress(makeWorkerProgress({ workerId: "w-2", role: "check", status: "done", task: "验收" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		const lines = panel.render(120);
		const all = lines.join("\n");
		// 标题
		expect(all).toContain("📊");
		// tab 栏含 2 个 worker
		expect(all).toContain("w-1");
		expect(all).toContain("w-2");
		// 当前 tab 内容是 w-1（第一个）
		expect(all).toContain("build");
	});

	it("子 worker 不在 tab 栏（仅父 worker）", () => {
		setProgress(makeWorkerProgress({ workerId: "team-1", role: "team", task: "team task" }));
		setProgress(makeWorkerProgress({ workerId: "team-1-a", role: "explore", parentWorkerId: "team-1" }));
		setProgress(makeWorkerProgress({ workerId: "team-1-b", role: "check", parentWorkerId: "team-1" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		const lines = panel.render(120);
		const all = lines.join("\n");
		// 父 worker 在 tab 栏 + 内容
		expect(all).toContain("team-1");
		// Nested workers section 存在
		expect(all).toMatch(/Nested workers/);
		// ↳ 缩进渲染子 worker
		expect(all).toContain("↳");
		// 子 worker 角色在嵌套 section（不是 workerId 本身，formatWorkerRow 不显示 workerId）
		expect(all).toContain("explore");
		expect(all).toContain("check");
	});

	it("Tab 键切换 worker tab", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1", role: "build" }));
		setProgress(makeWorkerProgress({ workerId: "w-2", role: "check", status: "done" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		// 初始 tab 0 = w-1
		expect(panel.render(120).join("\n")).toContain("build");
		// 按 Tab 切到 tab 1 = w-2
		panel.handleInput("\t");
		expect(panel.render(120).join("\n")).toContain("check");
		// 再按 Tab 回到 tab 0
		panel.handleInput("\t");
		expect(panel.render(120).join("\n")).toContain("build");
	});

	it("Shift+Tab 反向切 tab", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1" }));
		setProgress(makeWorkerProgress({ workerId: "w-2" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		// 初始 tab 0
		expect(panel.render(120).join("\n")).toContain("w-1");
		// Shift+Tab 反向：从 tab 0 → 最后一个 (tab 1)
		panel.handleInput("\x1b[Z"); // Shift+Tab
		expect(panel.render(120).join("\n")).toContain("w-2");
	});

	it("Esc 关掉正常 panel", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		panel.handleInput("\x1b"); // Esc
		return panel.donePromise.then((result) => {
			// 正常 panel Esc 返回 { action: "close" }，不是 null
			expect(result).toEqual({ action: "close" });
		});
	});

	it("dispose 路径清理（BUG #1 修复验证）", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		// 调 dispose 不抛错
		expect(() => panel.dispose()).not.toThrow();
		// dispose 后再调 handleInput 不抛错（应被忽略）
		expect(() => panel.handleInput("q")).not.toThrow();
	});
});

// ── 纯函数测试 ───────────────────────────────────────────

describe("buildTabBar (纯函数)", () => {
	beforeEach(() => {
		resetStore();
	});

	it("无 worker 时返回空 tab 提示", () => {
		const result = buildTabBar(makeMockTheme() as any, [], 0, 80);
		expect(result).toContain("no workers");
	});

	it("多个 worker 渲染 tab 列表", () => {
		const w1 = makeWorkerProgress({ workerId: "w-1" });
		const w2 = makeWorkerProgress({ workerId: "w-2" });
		const result = buildTabBar(makeMockTheme() as any, [w1, w2], 0, 80);
		expect(result).toContain("w-1");
		expect(result).toContain("w-2");
	});

	it("当前 tab 用 accent 主题高亮", () => {
		const w1 = makeWorkerProgress({ workerId: "w-1" });
		const w2 = makeWorkerProgress({ workerId: "w-2" });
		// active tab 用 accent，非 active 用 muted
		const result0 = buildTabBar({ ...makeMockTheme(), fg: (c, t) => `[${c}]${t}` } as any, [w1, w2], 0, 80);
		const result1 = buildTabBar({ ...makeMockTheme(), fg: (c, t) => `[${c}]${t}` } as any, [w1, w2], 1, 80);
		// currentIdx=0 时 w-1 是 accent
		expect(result0).toContain("[accent]");
		// currentIdx=1 时 w-2 是 accent
		expect(result1).toContain("[accent]");
	});
});

describe("buildTabContent (纯函数)", () => {
	beforeEach(() => {
		resetStore();
	});

	it("worker 存在时渲染 status / role / task", () => {
		const w = makeWorkerProgress({ workerId: "w-1", role: "build", task: "实现功能", toolCount: 3, elapsedMs: 5000 });
		const result = buildTabContent(makeMockTheme() as any, w, [], undefined, 80, {});
		const all = result.join("\n");
		expect(all).toContain("build");
		expect(all).toContain("实现功能");
		expect(all).toContain("5s"); // formatDuration 输出
	});

	it("title 行和 divider 等宽（避免对齐错位）", () => {
		const w = makeWorkerProgress({ workerId: "w-1", role: "build", task: "task" });
		// 多个 width 都验证对齐
		for (const width of [44, 60, 80, 100, 120]) {
			const result = buildTabContent(makeMockTheme() as any, w, [], undefined, width, {});
			// 无 Back to parent 时：result[0]=title, result[1]=divider
			const titleLine = result[0];
			const dividerLine = result[1];
			// mock theme 返回原文本（无 ANSI），长度 = visibleWidth
			expect(titleLine.length).toBe(width);
			expect(dividerLine.length).toBe(width);
		}
	});

	it("width=44 时 title 截断后 padEnd 补空格（不溢出）", () => {
		const w = makeWorkerProgress({ workerId: "w-very-long-id-1234567890", role: "very-long-role", task: "这是一个非常长的任务描述" });
		const result = buildTabContent(makeMockTheme() as any, w, [], undefined, 44, {});
		// divider (result[1]) 还是 44 字符
		expect(result[1].length).toBe(44);
		// title (result[0]) 截断后 padEnd 到 44 字符
		expect(result[0].length).toBe(44);
	});

	it("含子 worker 时渲染 Nested workers section", () => {
		const team = makeWorkerProgress({ workerId: "team-1", role: "team", task: "team task" });
		const child = makeWorkerProgress({ workerId: "team-1-a", role: "build", task: "子任务", parentWorkerId: "team-1" });
		const result = buildTabContent(makeMockTheme() as any, team, [child], undefined, 80, {});
		const all = result.join("\n");
		// formatWorkerRow 不渲染 workerId，只渲染 role + task + 状态
		expect(all).toMatch(/↳/);
		expect(all).toContain("子任务");
	});

	it("showBackToParent=true 时显示 ◀ 提示", () => {
		const w = makeWorkerProgress({ workerId: "team-1-a", role: "build", parentWorkerId: "team-1" });
		const result = buildTabContent(makeMockTheme() as any, w, [], undefined, 80, { showBackToParent: true });
		const all = result.join("\n");
		expect(all).toMatch(/Back|◀/);
	});
});

describe("formatNestedWorkers (纯函数)", () => {
	beforeEach(() => {
		resetStore();
	});

	it("无 children 时返回空数组", () => {
		const result = formatNestedWorkers(makeMockTheme() as any, "p", [], 80);
		expect(result).toEqual([]);
	});

	it("有 children 时渲染 ↳ 缩进 + role + task", () => {
		const child = makeWorkerProgress({ workerId: "team-1-a", role: "build", task: "子任务", parentWorkerId: "team-1" });
		const result = formatNestedWorkers(makeMockTheme() as any, "team-1", [child], 80);
		expect(result.length).toBeGreaterThan(0);
		expect(result.join("\n")).toMatch(/↳/);
		expect(result.join("\n")).toContain("子任务");
	});
});
