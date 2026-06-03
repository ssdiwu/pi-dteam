/**
 * TUI 渲染层 — dteam 工具的 TUI 渲染 + 实时进度显示
 *
 * L1 renderCall   — 工具调用时展示（类型 + 任务摘要）
 * L2 renderResult  — 工具返回时展示（折叠/展开双模式）
 * L3 registerMessageRenderer — worker 实时进度消息（最多3行）
 * session_start   — 注册底部状态栏（worker 状态）
 *
 * WorkerProgressStore：模块级 Map<workerId, WorkerProgress>
 *   - P4 内部所有 widget / signal bridge / 状态栏都从这里读
 *   - 测试可通过 getStore() 验证写入
 */

import type { ExtensionAPI, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Text, Container, Spacer } from "@earendil-works/pi-tui";
import type { SignalType } from "../P0/signal.js";

/** Minimal Theme interface */
interface Theme {
	fg(color: string, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	underline(text: string): string;
}

// ── Types ──────────────────────────────────────────────────────

/** Worker 实时进度（widget + 状态栏共享数据源） */
export interface WorkerProgress {
	/** 主键：worker 唯一标识 */
	workerId: string;
	/** 父 worker（team/chain 嵌套时使用） */
	parentWorkerId?: string;
	/** 执行角色（explore/design/build/...） */
	role: string;
	/** 当前状态 */
	status: "pending" | "running" | "done" | "failed";
	/** 任务描述 */
	task: string;
	/** 已用工具数 */
	toolCount: number;
	/** 当前正在执行的工具（来自 AgentProgress） */
	currentTool?: string;
	/** 启动时间（用于计算 elapsedMs） */
	startTime: number;
	/** 上次计算的耗时（ms） */
	elapsedMs: number;
	/** 是否是 chain 的 step */
	isChainStep?: boolean;
	/** chain step 序号（从 1 开始） */
	chainIndex?: number;
	/** chain 总步数 */
	chainTotal?: number;
	/** 最近一次信号 */
	lastSignal?: { type: SignalType; at: number };
	/** 信号累计计数 */
	signalCount: number;
	/** 终态错误信息（仅 failed） */
	finalError?: string;
}

// ── WorkerProgressStore（模块级单例） ─────────────────────────

/** 单一数据源：所有 worker 实时状态 */
const workerStore = new Map<string, WorkerProgress>();

/** 读取 store（widget 渲染 / 测试） */
export function getStore(): Map<string, WorkerProgress> {
	return workerStore;
}

/** 重置 store（测试 / session 切换） */
export function resetStore(): void {
	workerStore.clear();
}

/** 直接写入一条记录（供内部使用） */
export function setProgress(progress: WorkerProgress): void {
	workerStore.set(progress.workerId, progress);
}

/** 标记 worker 终态（done/failed） */
export function markTerminated(
	workerId: string,
	finalStatus: "done" | "failed",
	error?: string,
): void {
	const existing = workerStore.get(workerId);
	if (!existing) {
		// 没有记录则创建一条最小记录
		workerStore.set(workerId, {
			workerId,
			role: "unknown",
			status: finalStatus,
			task: "",
			toolCount: 0,
			startTime: Date.now(),
			elapsedMs: 0,
			signalCount: 0,
			finalError: error,
		});
		return;
	}
	existing.status = finalStatus;
	existing.elapsedMs = Date.now() - existing.startTime;
	if (error) existing.finalError = error;
}

/** 写入信号（更新 lastSignal + signalCount） */
export function recordSignal(workerId: string, signalType: SignalType): void {
	const existing = workerStore.get(workerId);
	if (!existing) return;
	existing.lastSignal = { type: signalType, at: Date.now() };
	existing.signalCount += 1;
}

/** 写入父 worker 关系（chain/team 嵌套） */
export function setParent(
	workerId: string,
	parentWorkerId: string,
	chainIndex?: number,
	chainTotal?: number,
): void {
	const existing = workerStore.get(workerId);
	if (!existing) return;
	existing.parentWorkerId = parentWorkerId;
	if (chainIndex !== undefined) {
		existing.chainIndex = chainIndex;
		existing.isChainStep = true;
	}
	if (chainTotal !== undefined) existing.chainTotal = chainTotal;
}

/** 3 秒后自动清理终态记录（让用户能看终态行再消失） */
const TERMINATE_KEEP_MS = 3000;
const pendingTerminateCleanup = new Map<string, ReturnType<typeof setTimeout>>();

export function scheduleTerminationCleanup(workerId: string): void {
	// 清理已有定时器
	const existing = pendingTerminateCleanup.get(workerId);
	if (existing) clearTimeout(existing);

	const t = setTimeout(() => {
		workerStore.delete(workerId);
		pendingTerminateCleanup.delete(workerId);
	}, TERMINATE_KEEP_MS);
	pendingTerminateCleanup.set(workerId, t);
}

// ── 旧 WorkerProgress 类型（保持 renderers.ts 内部 L3 兼容） ──

interface OldWorkerProgress {
	workerId: string;
	status: "pending" | "running" | "done" | "failed";
	task: string;
	style?: string;
	updatedAt: number;
}

// ── 全局状态（状态栏） ────────────────────────────────────────

/** 旧状态栏用的 Map（暂时保留供 setStatus 调用） */
const legacyStatusMap = new Map<string, OldWorkerProgress>();

// ── Helpers ────────────────────────────────────────────────────

function trim(text: string, max: number): string {
	return text.length > max ? `${text.slice(0, Math.max(0, max - 1))}…` : text;
}

function formatStatus(status: string): { icon: string; color: "success" | "error" | "warning" | "muted" } {
	switch (status) {
		case "done":
			return { icon: "✓", color: "success" };
		case "failed":
			return { icon: "✗", color: "error" };
		case "running":
			return { icon: "●", color: "warning" };
		default:
			return { icon: "○", color: "muted" };
	}
}

/** 计算所有 worker 状态极简计数："N workers · M running" */
export function formatWorkerCounts(): string {
	const all = Array.from(workerStore.values());
	const total = all.length;
	const running = all.filter((w) => w.status === "running").length;
	return `${total} workers · ${running} running`;
}

// ── 注册渲染器 ──────────────────────────────────────────────────

export function registerRenderers(pi: ExtensionAPI): void {
	// ── L3: registerMessageRenderer — worker 实时进度 ──

	pi.registerMessageRenderer("dteam-progress", (message, _options, theme) => {
		const content = typeof message.content === "string" ? message.content : "";
		const line = content.split("\n")[0] || content;

		// 解析 [DTEAM_PROGRESS] <workerId> <status> <task>
		const match = line.match(
			/\[DTEAM_PROGRESS\]\s*(\S+)\s+(pending|running|done|failed)\s+(.*)/,
		);
		if (!match) {
			return new Text(theme.fg("muted", trim(line, 120)), 0, 0);
		}

		const [, workerId, status, task] = match;
		const { icon, color } = formatStatus(status);

		// 同步到旧状态栏 Map（兼容旧 L3 渲染）
		legacyStatusMap.set(workerId, {
			workerId,
			status: status as WorkerProgress["status"],
			task,
			updatedAt: Date.now(),
		});

		// 构建显示行
		return new Text(
			`${theme.fg(color, icon)} ` +
				`${theme.fg("accent", workerId)} ` +
				`${theme.fg(color, `[${status}]`)} ` +
				`${theme.fg("dim", trim(task, 60))}`,
			0, 0,
		);
	});

	// ── session_start: 注册 setStatus 底部状态栏（极简计数） ──

	let unsubRender: (() => void) | null = null;

	pi.on("session_start", async (_event, ctx) => {
		// 移除旧监听器（session 重启 / /reload 时 ctx 已失效）
		if (unsubRender) {
			unsubRender();
			unsubRender = null;
		}

		const refreshStatus = () => {
			if (!ctx.hasUI) return;

			// 状态栏：极简计数 "N workers · M running"
			const all = Array.from(workerStore.values());
			if (all.length === 0) {
				ctx.ui.setStatus("dteam", undefined);
				return;
			}
			ctx.ui.setStatus("dteam", formatWorkerCounts());
		};

		// on() 返回取消订阅函数
		unsubRender = pi.events.on("dteam:render-status", refreshStatus);
	});
}

// ── 导出辅助函数 ──────────────────────────────────────────────────

/**
 * 更新 worker 进度（仅 TUI 状态栏，不发消息到聊天）
 */
export function emitWorkerProgress(
	pi: ExtensionAPI,
	workerId: string,
	status: "pending" | "running" | "done" | "failed",
	task: string,
) {
	// 同步到 store（如果还没有记录则创建最小记录）
	if (!workerStore.has(workerId)) {
		workerStore.set(workerId, {
			workerId,
			role: "unknown",
			status,
			task,
			toolCount: 0,
			startTime: Date.now(),
			elapsedMs: 0,
			signalCount: 0,
		});
	} else {
		const existing = workerStore.get(workerId)!;
		existing.status = status;
		existing.task = task;
	}

	// 同步到旧状态栏 Map（向后兼容 L3 渲染）
	legacyStatusMap.set(workerId, {
		workerId,
		status,
		task,
		updatedAt: Date.now(),
	});

	// 只触发状态栏刷新，不发消息到聊天流
	pi.events.emit("dteam:render-status", undefined);
}
