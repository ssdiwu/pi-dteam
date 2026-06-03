/**
 * P4-wrapWorker 单测：status 分支不再污染 workerStore
 *
 * 覆盖 3 条 status 查询路径：
 *   1) worker 不存在 → store 不被创建"虚拟"记录
 *   2) worker 存在 + running → 已存在记录的 task/role 不被覆盖
 *   3) worker 已 done + 3s 清理窗口内 → 已存在记录的 task/role 不被覆盖
 *
 * 修复说明：
 *   - 修复前：wrapWorker case "status" 无条件调 emitWorkerProgress，
 *     对不存在的 workerId 创建 role=unknown/task=Status check 的"虚拟"记录，
 *     对已存在的 worker 覆盖 task 文本为 "Status check"
 *   - 修复后：case "status" 不再调 emitWorkerProgress（语义上 status 是
 *     read 动作，不应触发 write 事件）
 *   - user-facing 反馈由 buildBriefReport 提供（"📊 Worker X: <status>"）
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { wrapWorker } from "../../src/P4/index.js";
import {
	getStore,
	resetStore,
	setProgress,
} from "../../src/P4/renderers.js";

// ── Mock 基础设施（与 worker-widget.test.ts 保持一致） ────────

function makeMockCtx(hasUI = true) {
	const widgets = new Map<string, any>();
	return {
		hasUI,
		cwd: "/tmp/test",
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

/** 构造一个最小 ExtensionAPI mock（仅满足 wrapWorker 调用需求） */
function makeMockPi() {
	return {
		events: {
			emit: vi.fn(),
			on: vi.fn(() => () => {}),
		},
	} as any;
}

/** 构造一个最小 WorkerProgress 记录 */
function makeProgress(overrides: any = {}) {
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

// ── 测试 ──────────────────────────────────────────────────────

describe("wrapWorker case 'status' — 不再污染 workerStore", () => {
	beforeEach(() => {
		resetStore();
	});

	// ═══════════════════════════════════════════════════════════
	// 测试 1：worker 不存在 → store 不创建"虚拟"记录
	// ═══════════════════════════════════════════════════════════

	it("worker 不存在时，store 保持为空（不创建 unknown/Status check 虚拟记录）", async () => {
		// G: store 初始为空
		expect(getStore().size).toBe(0);

		// W: 调 wrapWorker(workerStatus, "status", pi) 查询不存在的 workerId
		const fakeWorkerStatus = vi.fn(async (_ctx: any, params: any) => ({
			content: JSON.stringify({
				error: `Worker not found: ${params.workerId}`,
			}),
		}));
		const pi = makeMockPi();
		const ctx = makeMockCtx();
		const wrapped = wrapWorker(fakeWorkerStatus, "status", pi);
		await wrapped("call-1", { workerId: "w-not-exist" }, undefined, undefined, ctx);

		// A: store 仍为空，没有该 workerId
		expect(getStore().size).toBe(0);
		expect(getStore().has("w-not-exist")).toBe(false);

		// 二次确认：pi.events.emit 不应被调（emitWorkerProgress 是 source）
		// case "status" 不调 emitWorkerProgress → 不应触发 dteam:render-status
		const renderStatusCalls = (pi.events.emit as any).mock.calls.filter(
			(call: any[]) => call[0] === "dteam:render-status",
		);
		expect(renderStatusCalls.length).toBe(0);
	});

	// ═══════════════════════════════════════════════════════════
	// 测试 2：worker 存在 + running → 已存在记录的 task/role 不被覆盖
	// ═══════════════════════════════════════════════════════════

	it("worker 存在且 running 时，已存在记录的 task/role 不被覆盖为 'Status check'/'unknown'", async () => {
		// G: store 已有 worker 记录
		const existingId = "w-running";
		setProgress(
			makeProgress({
				workerId: existingId,
				role: "build",
				task: "原始任务",
				status: "running",
			}),
		);
		const before = getStore().get(existingId);
		expect(before?.task).toBe("原始任务");
		expect(before?.role).toBe("build");

		// W: 调 wrapWorker(workerStatus, "status", pi) 查询该 workerId
		const fakeWorkerStatus = vi.fn(async (_ctx: any, _params: any) => ({
			content: JSON.stringify({
				workerId: existingId,
				status: "running",
			}),
		}));
		const pi = makeMockPi();
		const ctx = makeMockCtx();
		const wrapped = wrapWorker(fakeWorkerStatus, "status", pi);
		await wrapped("call-1", { workerId: existingId }, undefined, undefined, ctx);

		// A: store 中该 worker 的 task 仍是 "原始任务"（不是 "Status check"）
		//    role 仍是 "build"（不是 "unknown"）
		const after = getStore().get(existingId);
		expect(after?.task).toBe("原始任务");
		expect(after?.task).not.toBe("Status check");
		expect(after?.role).toBe("build");
		expect(after?.role).not.toBe("unknown");

		// 二次确认：pi.events.emit 不应被调
		const renderStatusCalls = (pi.events.emit as any).mock.calls.filter(
			(call: any[]) => call[0] === "dteam:render-status",
		);
		expect(renderStatusCalls.length).toBe(0);
	});

	// ═══════════════════════════════════════════════════════════
	// 测试 3：worker 已 done + 3s 窗口内 → 已存在记录的 task/role 不被覆盖
	// ═══════════════════════════════════════════════════════════

	it("worker 已 done 且 store 记录在 3s 清理窗口内时，task/role 不被覆盖", async () => {
		// G: store 已有 done 状态记录（模拟 cleanup 窗口内场景）
		const existingId = "w-done";
		setProgress(
			makeProgress({
				workerId: existingId,
				role: "explore",
				task: "调研某事",
				status: "done",
			}),
		);
		const before = getStore().get(existingId);
		expect(before?.task).toBe("调研某事");
		expect(before?.role).toBe("explore");

		// W: 调 wrapWorker(workerStatus, "status", pi) 查询该 workerId
		const fakeWorkerStatus = vi.fn(async (_ctx: any, _params: any) => ({
			content: JSON.stringify({
				workerId: existingId,
				status: "done",
			}),
		}));
		const pi = makeMockPi();
		const ctx = makeMockCtx();
		const wrapped = wrapWorker(fakeWorkerStatus, "status", pi);
		await wrapped("call-1", { workerId: existingId }, undefined, undefined, ctx);

		// A: store 中该 worker 的 task 仍是 "调研某事"
		//    role 仍是 "explore"
		const after = getStore().get(existingId);
		expect(after?.task).toBe("调研某事");
		expect(after?.task).not.toBe("Status check");
		expect(after?.role).toBe("explore");
		expect(after?.role).not.toBe("unknown");

		// 二次确认：pi.events.emit 不应被调
		const renderStatusCalls = (pi.events.emit as any).mock.calls.filter(
			(call: any[]) => call[0] === "dteam:render-status",
		);
		expect(renderStatusCalls.length).toBe(0);
	});
});

// ── 回归：buildBriefReport 仍输出 📊 Worker X: <status> ────────

describe("wrapWorker case 'status' — 回归 user-facing 输出", () => {
	beforeEach(() => {
		resetStore();
	});

	it("worker 不存在时，buildBriefReport 返回错误信息（含 workerId）", async () => {
		const fakeWorkerStatus = vi.fn(async (_ctx: any, params: any) => ({
			content: JSON.stringify({
				error: `Worker not found: ${params.workerId}`,
			}),
		}));
		const pi = makeMockPi();
		const ctx = makeMockCtx();
		const wrapped = wrapWorker(fakeWorkerStatus, "status", pi);
		const result = await wrapped(
			"call-1",
			{ workerId: "w-missing" },
			undefined,
			undefined,
			ctx,
		);

		// result.content[0].text 应包含错误信息
		const text = result.content[0].text;
		expect(text).toContain("w-missing");
	});

	it("worker 存在时，buildBriefReport 返回 '📊 Worker X: <status>' 格式", async () => {
		const existingId = "w-alive";
		setProgress(
			makeProgress({
				workerId: existingId,
				role: "check",
				task: "验收任务",
				status: "running",
			}),
		);

		const fakeWorkerStatus = vi.fn(async (_ctx: any, _params: any) => ({
			content: JSON.stringify({
				workerId: existingId,
				status: "running",
			}),
		}));
		const pi = makeMockPi();
		const ctx = makeMockCtx();
		const wrapped = wrapWorker(fakeWorkerStatus, "status", pi);
		const result = await wrapped(
			"call-1",
			{ workerId: existingId },
			undefined,
			undefined,
			ctx,
		);

		// result.content[0].text 应是 📊 Worker X: running
		const text = result.content[0].text;
		expect(text).toContain("📊");
		expect(text).toContain(existingId);
		expect(text).toContain("running");
	});
});

// ── 回归：其他 case 行为不变（不应被本次修复误伤） ──────────────

describe("wrapWorker — 回归其他 case 行为不变", () => {
	beforeEach(() => {
		resetStore();
	});

	it("case 'create' 仍调 emitWorkerProgress（写 store）", async () => {
		const fakeWorkerCreate = vi.fn(async (_ctx: any, _params: any) => ({
			content: JSON.stringify({
				workerId: "w-create-1",
				config: { task: "新建任务" },
			}),
		}));
		const pi = makeMockPi();
		const ctx = makeMockCtx();
		const wrapped = wrapWorker(fakeWorkerCreate, "create", pi);
		await wrapped("call-1", { config: { type: "solo", task: "新建任务" } }, undefined, undefined, ctx);

		// A: store 中应有该 worker 记录（create 写入）
		expect(getStore().has("w-create-1")).toBe(true);
		const record = getStore().get("w-create-1");
		expect(record?.task).toBe("新建任务");
		expect(record?.status).toBe("pending");
	});

	it("case 'start' 仍调 emitWorkerProgress（写 store）", async () => {
		const fakeWorkerStart = vi.fn(async (_ctx: any, _params: any) => ({
			content: JSON.stringify({
				workerId: "w-start-1",
				config: { task: "执行中" },
			}),
		}));
		const pi = makeMockPi();
		const ctx = makeMockCtx();
		const wrapped = wrapWorker(fakeWorkerStart, "start", pi);
		await wrapped("call-1", { workerId: "w-start-1" }, undefined, undefined, ctx);

		// A: store 中应有该 worker 记录（start 写入 + 后续 registerWorkerTerminated 标记 done）
		// 关键：worker 必须存在于 store → 证明 emitWorkerProgress 被调了
		expect(getStore().has("w-start-1")).toBe(true);
		const record = getStore().get("w-start-1");
		// 前台 start：emitWorkerProgress("running", "Executing...") → 随后 registerWorkerTerminated("done")
		// 所以最终 status="done"，但 task 在 emitWorkerProgress 阶段被设为 "Executing..."
		expect(record?.task).toBe("Executing...");
		expect(record?.status).toBe("done"); // 前台 start 终态
	});
});
