/**
 * P4-store 单测：WorkerProgressStore + signal bridge
 *
 * 覆盖：
 *   - getStore / resetStore / setProgress
 *   - markTerminated（done/failed + finalError）
 *   - recordSignal（4 种信号类型 + 计数累加）
 *   - setParent（嵌套关系）
 *   - scheduleTerminationCleanup（3s 后自动清理）
 *   - formatWorkerCounts（极简计数 "N workers · M running"）
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import {
	getStore,
	resetStore,
	setProgress,
	markTerminated,
	recordSignal,
	setParent,
	scheduleTerminationCleanup,
	formatWorkerCounts,
} from "../../src/P4/renderers.js";

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

describe("WorkerProgressStore", () => {
	beforeEach(() => {
		resetStore();
		vi.useRealTimers();
	});

	describe("基本 CRUD", () => {
		it("getStore 返回模块级 Map", () => {
			const store = getStore();
			expect(store).toBeInstanceOf(Map);
		});

		it("setProgress 写入一条记录", () => {
			setProgress(makeProgress({ workerId: "w-a" }));
			expect(getStore().get("w-a")).toBeDefined();
		});

		it("resetStore 清空所有记录", () => {
			setProgress(makeProgress({ workerId: "w-a" }));
			setProgress(makeProgress({ workerId: "w-b" }));
			resetStore();
			expect(getStore().size).toBe(0);
		});
	});

	describe("markTerminated", () => {
		it("标记 done", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			markTerminated("w-1", "done");
			expect(getStore().get("w-1")?.status).toBe("done");
		});

		it("标记 failed + finalError", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			markTerminated("w-1", "failed", "spawn error");
			const p = getStore().get("w-1");
			expect(p?.status).toBe("failed");
			expect(p?.finalError).toBe("spawn error");
		});

		it("无记录时自动创建", () => {
			markTerminated("w-new", "done");
			const p = getStore().get("w-new");
			expect(p).toBeDefined();
			expect(p?.status).toBe("done");
			expect(p?.role).toBe("unknown");
		});

		it("done 时更新 elapsedMs", () => {
			const start = Date.now() - 5000;
			setProgress(makeProgress({ workerId: "w-1", startTime: start }));
			markTerminated("w-1", "done");
			const p = getStore().get("w-1");
			expect(p?.elapsedMs).toBeGreaterThanOrEqual(5000);
		});
	});

	describe("recordSignal", () => {
		it("记录 progress 信号", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			recordSignal("w-1", "progress");
			const p = getStore().get("w-1");
			expect(p?.signalCount).toBe(1);
			expect(p?.lastSignal?.type).toBe("progress");
		});

		it("记录 blocked 信号", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			recordSignal("w-1", "blocked");
			expect(getStore().get("w-1")?.lastSignal?.type).toBe("blocked");
		});

		it("记录 found 信号", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			recordSignal("w-1", "found");
			expect(getStore().get("w-1")?.lastSignal?.type).toBe("found");
		});

		it("记录 help 信号", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			recordSignal("w-1", "help");
			expect(getStore().get("w-1")?.lastSignal?.type).toBe("help");
		});

		it("多次信号累加计数", () => {
			setProgress(makeProgress({ workerId: "w-1" }));
			recordSignal("w-1", "progress");
			recordSignal("w-1", "progress");
			recordSignal("w-1", "blocked");
			expect(getStore().get("w-1")?.signalCount).toBe(3);
			expect(getStore().get("w-1")?.lastSignal?.type).toBe("blocked"); // 最后一次
		});

		it("无记录时静默忽略", () => {
			expect(() => recordSignal("nonexistent", "progress")).not.toThrow();
		});
	});

	describe("setParent", () => {
		it("设置 parentWorkerId", () => {
			setProgress(makeProgress({ workerId: "child-1" }));
			setParent("child-1", "team-1");
			expect(getStore().get("child-1")?.parentWorkerId).toBe("team-1");
		});

		it("设置 chainIndex + isChainStep", () => {
			setProgress(makeProgress({ workerId: "step-1" }));
			setParent("step-1", "chain-1", 2, 5);
			const p = getStore().get("step-1");
			expect(p?.chainIndex).toBe(2);
			expect(p?.chainTotal).toBe(5);
			expect(p?.isChainStep).toBe(true);
		});

		it("无记录时静默忽略", () => {
			expect(() => setParent("nonexistent", "team-1")).not.toThrow();
		});
	});

	describe("scheduleTerminationCleanup", () => {
		it("3s 后自动清理", () => {
			vi.useFakeTimers();
			setProgress(makeProgress({ workerId: "w-1" }));
			scheduleTerminationCleanup("w-1");
			expect(getStore().has("w-1")).toBe(true);
			vi.advanceTimersByTime(3100);
			expect(getStore().has("w-1")).toBe(false);
		});

		it("3s 内不清理", () => {
			vi.useFakeTimers();
			setProgress(makeProgress({ workerId: "w-1" }));
			scheduleTerminationCleanup("w-1");
			vi.advanceTimersByTime(2000);
			expect(getStore().has("w-1")).toBe(true);
		});

		it("重复调用重置定时器", () => {
			vi.useFakeTimers();
			setProgress(makeProgress({ workerId: "w-1" }));
			scheduleTerminationCleanup("w-1");
			vi.advanceTimersByTime(2000);
			scheduleTerminationCleanup("w-1"); // 重置
			vi.advanceTimersByTime(2000);
			expect(getStore().has("w-1")).toBe(true);
			vi.advanceTimersByTime(1100);
			expect(getStore().has("w-1")).toBe(false);
		});
	});

	describe("formatWorkerCounts", () => {
		it("空 store 返回 '0 workers · 0 running'", () => {
			expect(formatWorkerCounts()).toBe("0 workers · 0 running");
		});

		it("2 个 worker + 1 个 running", () => {
			setProgress(makeProgress({ workerId: "w-1", status: "running" }));
			setProgress(makeProgress({ workerId: "w-2", status: "done" }));
			expect(formatWorkerCounts()).toBe("2 workers · 1 running");
		});

		it("3 个 running", () => {
			setProgress(makeProgress({ workerId: "w-1", status: "running" }));
			setProgress(makeProgress({ workerId: "w-2", status: "running" }));
			setProgress(makeProgress({ workerId: "w-3", status: "running" }));
			expect(formatWorkerCounts()).toBe("3 workers · 3 running");
		});

		it("所有 done", () => {
			setProgress(makeProgress({ workerId: "w-1", status: "done" }));
			setProgress(makeProgress({ workerId: "w-2", status: "done" }));
			expect(formatWorkerCounts()).toBe("2 workers · 0 running");
		});
	});
});
