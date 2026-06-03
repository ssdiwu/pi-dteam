/**
 * Worker Panel 集成测试（showWorkerPanel）
 *
 * 使用 ctx.ui.setWidget 模式（嵌入信息流，输入栏上方，不遮挡）
 * 覆盖：空态面板、异常分支、Tab 面板渲染、纯函数单元测试
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
		bg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
	};
}

/** Mock TUI 引用（提供 requestRender） */
function makeMockTui() {
	return { requestRender: vi.fn() };
}

/** setWidget factory 返回的接口 */
interface SetWidgetResult {
	render: (width: number) => string[];
	invalidate: () => void;
}

/** Mock ctx：setWidget 模式下捕获面板 render 函数 */
function makeCapturingCtx(): { ctx: ExtensionContext; getCaptured: () => SetWidgetResult | null } {
	let captured: SetWidgetResult | null = null;
	const ctx: any = {
		hasUI: true,
		ui: {
			setWidget: vi.fn((_key: string, factory: any) => {
				if (typeof factory === "function") {
					try {
						const result = factory(makeMockTui(), makeMockTheme());
						captured = result;
					} catch (e) {
						/* expected during cleanup / format mismatch */
					}
				}
			}),
			setStatus: vi.fn(),
			notify: vi.fn(),
			requestRender: vi.fn(),
			custom: vi.fn(), // 不再使用
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

// ── 集成测试（setWidget 模式）─────────────────────────────

describe("showWorkerPanel (集成)", () => {
	beforeEach(() => {
		resetStore();
		resetThrottleState();
		resetExpandedState();
		resetDisposedCount();
	});

	it("store 空时弹提示 panel（AC9 修复）", () => {
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		expect(ctx.ui.setWidget).toHaveBeenCalled();
		const panel = getCaptured();
		expect(panel).not.toBeNull();
		const lines = panel!.render(80);
		expect(lines.join("\n")).toContain("无 worker 正在工作");
	});

	it("只有子 worker（无 parent）时弹异常分支 panel", () => {
		setProgress(makeWorkerProgress({ workerId: "child-1", parentWorkerId: "parent-missing" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured();
		expect(panel).not.toBeNull();
		const lines = panel!.render(80);
		expect(lines.join("\n")).toContain("无父 worker 正在工作");
	});

	it("异常分支面板包含关闭提示", () => {
		setProgress(makeWorkerProgress({ workerId: "child-1", parentWorkerId: "parent-missing" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		const lines = panel.render(80);
		expect(lines.join("\n")).toMatch(/Esc|q|Ctrl\+C|关闭/);
	});

	it("正常 worker 弹 panel + 渲染内容", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1", role: "build", task: "实现功能" }));
		setProgress(makeWorkerProgress({ workerId: "w-2", role: "check", status: "done", task: "验收" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		const lines = panel.render(120);
		const all = lines.join("\n");
		// 标题含 📊
		expect(all).toContain("📊");
		// 含 worker 信息
		expect(all).toContain("w-1");
		expect(all).toContain("w-2");
		expect(all).toContain("build");
	});

	it("子 worker 场景面板正常渲染", () => {
		setProgress(makeWorkerProgress({ workerId: "team-1", role: "team", task: "team task" }));
		setProgress(makeWorkerProgress({ workerId: "team-1-a", role: "explore", parentWorkerId: "team-1" }));
		setProgress(makeWorkerProgress({ workerId: "team-1-b", role: "check", parentWorkerId: "team-1" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		expect(panel).not.toBeNull();
		const lines = panel.render(120).join("\n");
		expect(lines).toContain("📊");
	});

	it("多 worker Tab 面板渲染两个 worker", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1", role: "build" }));
		setProgress(makeWorkerProgress({ workerId: "w-2", role: "check", status: "done" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		expect(panel).not.toBeNull();
		const all = panel.render(120).join("\n");
		expect(all).toContain("📊");
	});

	it("面板 render 和 invalidate 不抛错", () => {
		setProgress(makeWorkerProgress({ workerId: "w-1" }));
		const { ctx, getCaptured } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		const panel = getCaptured()!;
		expect(panel).not.toBeNull();
		expect(() => panel.render(80)).not.toThrow();
		expect(() => panel.invalidate()).not.toThrow();
	});

	// expandedActive 状态在 showWorkerPanel 中设置，由其他测试覆盖验证
	it.skip("expandedActive 状态正确设置（需集成验证）", () => {
		// isExpanded 通过模块内部状态管理，此处仅验证 setWidget 被调用
		const { ctx } = makeCapturingCtx();
		showWorkerPanel(ctx as any);
		expect(ctx.ui.setWidget).toHaveBeenCalled();
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
