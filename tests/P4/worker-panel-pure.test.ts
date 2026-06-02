/**
 * P4-worker-panel 纯函数单测
 *
 * 覆盖（无 TUI runtime 依赖）：
 *   - buildTabBar：多 worker 切换 / 当前选中态 / 超出折叠 / 空 store
 *   - buildTabContent：完整字段渲染 / Recent Output 截断 / nested 区域
 *   - formatNestedWorkers：嵌套排序（chainIndex 优先 + startTime 兜底）/ 缩进
 *
 * 集成测试（mock ctx.ui.custom）在 worker-panel.test.ts 单独覆盖。
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
	buildTabBar,
	buildTabContent,
	formatNestedWorkers,
} from "../../src/P4/worker-widget.js";
import type { ExtendedProgressData } from "../../src/P4/worker-widget.js";
import { resetStore, setProgress, type WorkerProgress } from "../../src/P4/renderers.js";
import { visibleWidth } from "@earendil-works/pi-tui";

// ── Mock helpers ──────────────────────────────────────────

function makeMockTheme() {
	return {
		fg: (_color: string, text: string) => text,
		bold: (text: string) => text,
		italic: (text: string) => text,
		underline: (text: string) => text,
	};
}

function makeProgress(overrides: Partial<WorkerProgress> = {}): WorkerProgress {
	const now = Date.now();
	return {
		workerId: "w-1",
		role: "build",
		status: "running",
		task: "实现功能",
		toolCount: 0,
		startTime: now,
		elapsedMs: 0,
		signalCount: 0,
		...overrides,
	};
}

// ── 测试 ──────────────────────────────────────────────────

describe("buildTabBar (纯函数)", () => {
	beforeEach(() => {
		resetStore();
	});

	it("空 parents：返回 '(no workers)'", () => {
		const result = buildTabBar(makeMockTheme() as any, [], 0, 80);
		expect(result).toContain("no workers");
	});

	it("1 个 worker：单个 tab label", () => {
		const p = makeProgress({ workerId: "w-1", role: "build" });
		const result = buildTabBar(makeMockTheme() as any, [p], 0, 80);
		expect(result).toContain("w-1");
		expect(result).toContain("●"); // running
	});

	it("多 worker：每个 tab label 都出现", () => {
		const parents = [
			makeProgress({ workerId: "w-1", role: "build" }),
			makeProgress({ workerId: "w-2", role: "check" }),
			makeProgress({ workerId: "team-3", role: "team" }),
		];
		const result = buildTabBar(makeMockTheme() as any, parents, 0, 80);
		expect(result).toContain("w-1");
		expect(result).toContain("w-2");
		expect(result).toContain("team-3");
	});

	it("currentIdx 标记不同：active tab 内容相同（颜色由 theme 处理）", () => {
		// 注：buildTabBar 把 active 状态通过 theme.fg 表达，mock theme 返回原文本
		// 这里只验证 currentIdx 不影响 tab 数量
		const parents = [
			makeProgress({ workerId: "w-1" }),
			makeProgress({ workerId: "w-2" }),
			makeProgress({ workerId: "w-3" }),
		];
		const r0 = buildTabBar(makeMockTheme() as any, parents, 0, 80);
		const r2 = buildTabBar(makeMockTheme() as any, parents, 2, 80);
		// 都包含 3 个 workerId（顺序、内容一致）
		expect(r0).toContain("w-1");
		expect(r0).toContain("w-2");
		expect(r0).toContain("w-3");
		expect(r2).toContain("w-1");
		expect(r2).toContain("w-2");
		expect(r2).toContain("w-3");
	});

	it(">10 workers：折叠为 '[+N more]'", () => {
		const parents = Array.from({ length: 15 }, (_, i) =>
			makeProgress({ workerId: `w-${i}` }),
		);
		const result = buildTabBar(makeMockTheme() as any, parents, 0, 200);
		expect(result).toContain("+5 more");
		// 只显示前 10 个
		expect(result).toContain("w-0");
		expect(result).toContain("w-9");
		// 不显示 10+
		expect(result).not.toContain("w-10 ");
	});

	it("状态图标：running=● / done=✓ / failed=✗ / pending=○", () => {
		const parents = [
			makeProgress({ workerId: "w-running", status: "running" }),
			makeProgress({ workerId: "w-done", status: "done" }),
			makeProgress({ workerId: "w-failed", status: "failed" }),
			makeProgress({ workerId: "w-pending", status: "pending" }),
		];
		const result = buildTabBar(makeMockTheme() as any, parents, 0, 200);
		expect(result).toContain("●");
		expect(result).toContain("✓");
		expect(result).toContain("✗");
		expect(result).toContain("○");
	});

	it("宽度截断：width 不足时按 visible width 截断", () => {
		const parents = [
			makeProgress({ workerId: "w-1" }),
			makeProgress({ workerId: "w-2" }),
		];
		const result = buildTabBar(makeMockTheme() as any, parents, 0, 10);
		expect(visibleWidth(result)).toBeLessThanOrEqual(10);
	});
});

// ──────────────────────────────────────────────────────────

describe("buildTabContent (纯函数)", () => {
	beforeEach(() => {
		resetStore();
	});

	it("基本字段：标题 + Task + Current Tool + Token + Activity", () => {
		const p = makeProgress({
			workerId: "w-1",
			role: "build",
			status: "running",
			task: "实现功能",
			toolCount: 3,
			elapsedMs: 5000,
		});
		const extended: ExtendedProgressData = {
			currentTool: "bash",
			recentOutput: "$ npm test\n✓ pass",
			tokenCount: 1234,
			duration: 5000,
			activityFreshness: Date.now() - 1000,
		};
		const lines = buildTabContent(makeMockTheme() as any, p, [], extended, 80);
		const all = lines.join("\n");
		expect(all).toContain("build");
		expect(all).toContain("running");
		expect(all).toContain("Task: 实现功能");
		expect(all).toContain("Current Tool: bash");
		expect(all).toContain("Token Count: 1,234");
	});

	it("Recent Output：每行 > 前缀，最多 8 行", () => {
		const p = makeProgress({ workerId: "w-1" });
		const manyLines = Array.from({ length: 20 }, (_, i) => `line ${i}`).join("\n");
		const extended: ExtendedProgressData = {
			duration: 0,
			activityFreshness: 0,
			recentOutput: manyLines,
		};
		const lines = buildTabContent(makeMockTheme() as any, p, [], extended, 80);
		const all = lines.join("\n");
		// 只显示最后 8 行
		expect(all).toContain("line 12");
		expect(all).toContain("line 19");
		expect(all).not.toContain("line 0");
		expect(all).not.toContain("line 11");
		// 每行有 > 前缀
		expect(all).toContain("> line 19");
	});

	it("failed 状态 + finalError：显示 Error: 行", () => {
		const p = makeProgress({
			workerId: "w-1",
			status: "failed",
			finalError: "spawn failed",
		});
		const lines = buildTabContent(makeMockTheme() as any, p, [], undefined, 80);
		const all = lines.join("\n");
		expect(all).toContain("Error: spawn failed");
	});

	it("showBackToParent=true：顶部有 '◀ Back to parent' 提示", () => {
		const p = makeProgress({ workerId: "w-1" });
		const lines = buildTabContent(
			makeMockTheme() as any,
			p,
			[],
			undefined,
			80,
			{ showBackToParent: true },
		);
		expect(lines[0]).toContain("Back to parent");
	});

	it("无 extended：Recent Output 显示 '(no output yet)'", () => {
		const p = makeProgress({ workerId: "w-1" });
		const lines = buildTabContent(makeMockTheme() as any, p, [], undefined, 80);
		const all = lines.join("\n");
		expect(all).toContain("(no output yet)");
	});

	it("children 非空：底部追加 'Nested workers' 区域", () => {
		const p = makeProgress({ workerId: "team-1", role: "team" });
		const kids = [
			makeProgress({ workerId: "team-1-0", role: "build", task: "子任务 0", parentWorkerId: "team-1" }),
			makeProgress({ workerId: "team-1-1", role: "check", task: "子任务 1", parentWorkerId: "team-1" }),
		];
		const lines = buildTabContent(makeMockTheme() as any, p, kids, undefined, 80);
		const all = lines.join("\n");
		expect(all).toContain("Nested workers (2)");
		expect(all).toContain("子任务 0");
		expect(all).toContain("子任务 1");
		// 提示 Enter 进入详情
		expect(all).toContain("Press Enter");
	});

	it("信号徽章：标题行包含信号 emoji + ×N", () => {
		const p = makeProgress({
			workerId: "w-1",
			signalCount: 3,
			lastSignal: { type: "blocked", at: Date.now() },
		});
		const lines = buildTabContent(makeMockTheme() as any, p, [], undefined, 80);
		// 第 0 行是可选的 Back（这里没有），所以是 Back/title 任一
		// 我们直接搜整段
		const all = lines.join("\n");
		expect(all).toContain("🚧×3");
	});
});

// ──────────────────────────────────────────────────────────

describe("formatNestedWorkers (纯函数)", () => {
	beforeEach(() => {
		resetStore();
	});

	it("按 chainIndex 排序（chain 模式）", () => {
		const parent = makeProgress({ workerId: "chain-1" });
		const kids = [
			makeProgress({ workerId: "chain-1-3", role: "step3", chainIndex: 3, chainTotal: 5, isChainStep: true, parentWorkerId: "chain-1" }),
			makeProgress({ workerId: "chain-1-1", role: "step1", chainIndex: 1, chainTotal: 5, isChainStep: true, parentWorkerId: "chain-1" }),
			makeProgress({ workerId: "chain-1-2", role: "step2", chainIndex: 2, chainTotal: 5, isChainStep: true, parentWorkerId: "chain-1" }),
		];
		const lines = formatNestedWorkers(makeMockTheme() as any, parent, kids, 80);
		// 验证顺序：step1 在 step2 前面，step2 在 step3 前面
		const idx1 = lines.findIndex((l) => l.includes("step1"));
		const idx2 = lines.findIndex((l) => l.includes("step2"));
		const idx3 = lines.findIndex((l) => l.includes("step3"));
		expect(idx1).toBeGreaterThanOrEqual(0);
		expect(idx2).toBeGreaterThanOrEqual(0);
		expect(idx3).toBeGreaterThanOrEqual(0);
		expect(idx1).toBeLessThan(idx2);
		expect(idx2).toBeLessThan(idx3);
	});

	it("无 chainIndex：按 startTime 排序（team 模式）", () => {
		const t0 = Date.now() - 3000;
		const t1 = Date.now() - 2000;
		const t2 = Date.now() - 1000;
		const parent = makeProgress({ workerId: "team-1" });
		const kids = [
			makeProgress({ workerId: "team-1-2", role: "sub2", parentWorkerId: "team-1", startTime: t2 }),
			makeProgress({ workerId: "team-1-0", role: "sub0", parentWorkerId: "team-1", startTime: t0 }),
			makeProgress({ workerId: "team-1-1", role: "sub1", parentWorkerId: "team-1", startTime: t1 }),
		];
		const lines = formatNestedWorkers(makeMockTheme() as any, parent, kids, 80);
		const idx0 = lines.findIndex((l) => l.includes("sub0"));
		const idx1 = lines.findIndex((l) => l.includes("sub1"));
		const idx2 = lines.findIndex((l) => l.includes("sub2"));
		expect(idx0).toBeGreaterThanOrEqual(0);
		expect(idx1).toBeGreaterThanOrEqual(0);
		expect(idx2).toBeGreaterThanOrEqual(0);
		expect(idx0).toBeLessThan(idx1);
		expect(idx1).toBeLessThan(idx2);
	});

	it("每个 child 行带 '  ↳ ' 缩进", () => {
		const parent = makeProgress({ workerId: "team-1" });
		const kids = [
			makeProgress({ workerId: "team-1-0", role: "build", parentWorkerId: "team-1" }),
		];
		const lines = formatNestedWorkers(makeMockTheme() as any, parent, kids, 80);
		expect(lines[0]).toMatch(/^  ↳/);
	});

	it("空 children：返回空数组", () => {
		const parent = makeProgress({ workerId: "team-1" });
		const lines = formatNestedWorkers(makeMockTheme() as any, parent, [], 80);
		expect(lines).toEqual([]);
	});
});
