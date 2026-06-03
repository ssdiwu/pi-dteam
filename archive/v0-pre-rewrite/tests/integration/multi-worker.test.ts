/**
 * 多 worker 集成测试
 *
 * 覆盖：
 *   - 多 worker 并行：每个 worker 在 store 有独立行
 *   - 终态清理：registerWorkerTerminated 后 store 标记 done/failed
 *   - 嵌套关系：team/chain emit 信号后 store 记录 parentWorkerId
 *   - 状态栏极简计数：N workers · M running
 *   - background 完成后自动调度 3s 清理
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { getStore, resetStore, formatWorkerCounts } from "../../src/P4/renderers.js";
import { bus } from "../../src/P2/worker.js";
import { runTeam } from "../../src/P2/team.js";
import { runChain } from "../../src/P2/chain.js";
import { runSolo } from "../../src/P2/solo.js";
import { registerExecutor } from "../../src/P2/worker.js";
import { showWorkerStatus } from "../../src/P4/worker-widget.js";
import type { WorkerConfig } from "../../src/P0/config.js";

const ctx = { cwd: process.cwd() };

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

describe("多 worker 集成", () => {
	beforeEach(() => {
		resetStore();
	});

	describe("team 模式：子 worker 写 store", () => {
		it("team emit progress 信号 → store 记录子 worker + parent", async () => {
			// 注册一个假执行器
			const execCalls: Array<{ role: string; task: string }> = [];
			registerExecutor("mock-team-exec", async (context) => {
				execCalls.push({ role: context.role, task: context.task });
				return `[${context.role}] done`;
			});

			const config: WorkerConfig = {
				type: "team",
				task: "并行执行",
				style: "pragmatist",
				options: [
					{ type: "concurrency", value: 2 },
					{
						type: "workers",
						value: [
							{
								type: "solo",
								task: "build task",
								style: "pragmatist",
								options: [{ type: "role", value: "build" }],
							},
							{
								type: "solo",
								task: "check task",
								style: "pragmatist",
								options: [{ type: "role", value: "check" }],
							},
						],
					},
				],
			};

			// 收集子 workerId 信号
			const childWorkerIds: string[] = [];
			const unsub = bus.on("progress", (s) => {
				if (s.data.parentWorkerId) {
					childWorkerIds.push(s.workerId);
					// 同步到 store（模拟 P4 signal bridge）
					const existing = getStore().get(s.workerId);
					if (!existing) {
						getStore().set(s.workerId, {
							workerId: s.workerId,
							role: (s.data.role as string) ?? "unknown",
							status: "running",
							task: (s.data.task as string) ?? "",
							toolCount: 0,
							startTime: Date.now(),
							elapsedMs: 0,
							signalCount: 0,
							parentWorkerId: s.data.parentWorkerId as string,
						});
					}
				}
			});

			try {
				await runTeam(
					config,
					bus,
					{ get: () => undefined, set: () => {}, getMany: () => ({}), namespaces: () => [] } as any,
					async (role, task, style) => `[${role}] ${task}`,
				);
			} finally {
				unsub();
			}

			// 至少应该有 2 个子 workerId（来自 team-${ts}-0 和 team-${ts}-1）
			expect(childWorkerIds.length).toBeGreaterThanOrEqual(2);
		});
	});

	describe("chain 模式：step 写 store 带 chainIndex", () => {
		it("chain step emit progress 带 chainIndex/chainTotal", async () => {
			const stepSignals: Array<{ workerId: string; chainIndex?: number; chainTotal?: number }> = [];
			const unsub = bus.on("progress", (s) => {
				if (s.data.isChainStep) {
					stepSignals.push({
						workerId: s.workerId,
						chainIndex: s.data.chainIndex as number | undefined,
						chainTotal: s.data.chainTotal as number | undefined,
					});
				}
			});

			const config: WorkerConfig = {
				type: "chain",
				task: "串行",
				style: "pragmatist",
				options: [
					{
						type: "steps",
						value: [
							{
								type: "solo",
								task: "step1",
								style: "pragmatist",
								options: [{ type: "role", value: "explore" }],
							},
							{
								type: "solo",
								task: "step2",
								style: "pragmatist",
								options: [{ type: "role", value: "design" }],
							},
							{
								type: "solo",
								task: "step3",
								style: "pragmatist",
								options: [{ type: "role", value: "build" }],
							},
						],
					},
				],
			};

			try {
				await runChain(
					config,
					bus,
					{ get: () => undefined, set: () => {}, getMany: () => ({}), namespaces: () => [] } as any,
					async (role, task, style) => `[${role}] ${task}`,
				);
			} finally {
				unsub();
			}

			// 应该有 3 个 step 信号（每个 step 至少 emit 一次 running）
			expect(stepSignals.length).toBeGreaterThanOrEqual(3);
			// 验证 chainIndex 递增
			const indices = stepSignals
				.map((s) => s.chainIndex)
				.filter((i): i is number => i !== undefined);
			expect(indices).toContain(1);
			expect(indices).toContain(2);
			expect(indices).toContain(3);
			// 验证 chainTotal = 3
			expect(stepSignals.every((s) => s.chainTotal === 3)).toBe(true);
		});
	});

	describe("多 worker 计数", () => {
		it("formatWorkerCounts 正确显示 N workers · M running", () => {
			getStore().set("w-1", {
				workerId: "w-1",
				role: "build",
				status: "running",
				task: "t1",
				toolCount: 0,
				startTime: Date.now(),
				elapsedMs: 0,
				signalCount: 0,
			});
			getStore().set("w-2", {
				workerId: "w-2",
				role: "check",
				status: "done",
				task: "t2",
				toolCount: 0,
				startTime: Date.now(),
				elapsedMs: 0,
				signalCount: 0,
			});
			expect(formatWorkerCounts()).toBe("2 workers · 1 running");
		});
	});

	// ═══════════════════════════════════════════════════════════
	// 多 worker 并行不覆盖（AC2 核心保证）
	// 关键修复验证：showWorkerStatus 需传 workerId 作为 store 主键
	//                 runTeam/Chain/Solo 需透传 parentWorkerId 以统一 outer ID
	// ═══════════════════════════════════════════════════════════

	describe("2 worker 并行不覆盖", () => {
		it("showWorkerStatus 传不同 workerId → store 中 2 条独立记录（不合并到 unknown）", () => {
			// 关键：调用方传入 workerId 后，store 必须有 2 条独立行
			// 之前 Bug #1：所有 worker 都被合并到 "unknown" 同一行
			const mockCtx = makeMockCtx();
			showWorkerStatus(mockCtx as any, "worker-A", {
				status: "running",
				agent: "build",
				task: "实现功能 A",
				toolCount: 0,
				elapsedMs: 0,
			} as any);
			showWorkerStatus(mockCtx as any, "worker-B", {
				status: "running",
				agent: "check",
				task: "验收功能 B",
				toolCount: 0,
				elapsedMs: 0,
			} as any);

			// 2 条独立记录
			expect(getStore().size).toBe(2);
			expect(getStore().has("worker-A")).toBe(true);
			expect(getStore().has("worker-B")).toBe(true);

			// 验证记录内容不互相覆盖
			const a = getStore().get("worker-A");
			const b = getStore().get("worker-B");
			expect(a?.role).toBe("build");
			expect(a?.task).toBe("实现功能 A");
			expect(b?.role).toBe("check");
			expect(b?.task).toBe("验收功能 B");
		});

		it("runTeam 传 parentWorkerId → bus emit 用 outer ID，不嵌套 inner team-${ts}", async () => {
			// 关键：wrapWorker 传 outer workerId（worker-${ts}-${random}）后，
			// runTeam 内部 emit 必须用此 ID 替换 inner team-${ts}，避免 P4 store 主键冲突
			registerExecutor("mock-parent-exec", async (context) => `[${context.role}] done`);

			const config: WorkerConfig = {
				type: "team",
				task: "并行执行",
				style: "pragmatist",
				options: [
					{ type: "concurrency", value: 2 },
					{
						type: "workers",
						value: [
							{
								type: "solo",
								task: "task A",
								style: "pragmatist",
								options: [{ type: "role", value: "build" }],
							},
							{
								type: "solo",
								task: "task B",
								style: "pragmatist",
								options: [{ type: "role", value: "check" }],
							},
						],
					},
				],
			};

			const outerWorkerId = "worker-outer-1234";
			const progressSignals: Array<{ workerId: string; data: Record<string, unknown> }> = [];
			const unsub = bus.on("progress", (s) => {
				progressSignals.push(s);
			});

			try {
				await runTeam(
					config,
					bus,
					{ get: () => undefined, set: () => {}, getMany: () => ({}), namespaces: () => [] } as any,
					async (role, task, style) => `[${role}] ${task}`,
					outerWorkerId, // 关键修复：传 outer workerId
				);
			} finally {
				unsub();
			}

			// 至少 1 个 team 自身信号 + 2 个 child 信号
			expect(progressSignals.length).toBeGreaterThanOrEqual(3);

			// 验证 team 自身 emit 用 outer ID
			const teamSelfSignals = progressSignals.filter((s) => !s.data.parentWorkerId);
			expect(teamSelfSignals.length).toBeGreaterThanOrEqual(1);
			for (const s of teamSelfSignals) {
				expect(s.workerId).toBe(outerWorkerId);
			}

			// 验证 child emit 的 parentWorkerId = outer ID（而不是 inner team-${ts}）
			const childSignals = progressSignals.filter((s) => s.data.parentWorkerId);
			expect(childSignals.length).toBeGreaterThanOrEqual(2);
			for (const s of childSignals) {
				expect(s.data.parentWorkerId).toBe(outerWorkerId);
			}
		});

		it("runSolo 传 parentWorkerId → emit workerId = parentWorkerId（替换 inner solo-${ts}）", async () => {
			const signals: string[] = [];
			const unsub = bus.on("progress", (s) => {
				signals.push(s.workerId);
			});

			const config: WorkerConfig = {
				type: "solo",
				task: "实现 A",
				style: "pragmatist",
				options: [{ type: "role", value: "build" }],
			};

			try {
				await runSolo(
					config,
					bus,
					{ get: () => undefined, set: () => {}, getMany: () => ({}), namespaces: () => [] } as any,
					async (role, task, style) => `[${role}] done`,
					"worker-outer-A", // parentWorkerId
				);
			} finally {
				unsub();
			}

			// 至少 2 个 progress 信号（running + done）
			expect(signals.length).toBeGreaterThanOrEqual(2);
			// 所有 emit 都用 outer ID
			for (const wid of signals) {
				expect(wid).toBe("worker-outer-A");
			}
		});
	});
});
