/**
 * Worker 状态 Widget — 在 TUI 中显示 worker 实时状态
 *
 * 三层状态：
 *   - 折叠态：多 worker 单行 + 2 空格缩进 + ↳ + 信号角标
 *   - 展开态：全屏覆盖层显示 AgentProgress 详细信息（Ctrl+O 切换）
 *   - 状态栏：极简计数 "N workers · M running"
 *
 * 数据流：
 *   wrapWorker 注入 onProgress(workerId) 闭包
 *     → updateAgentProgress(workerId, p)
 *       → store.set(workerId, ...)
 *       → activeTui?.requestRender()  ← widget 1s 间隔跳秒
 *
 * 字段映射：currentTool / recentOutput / tokenCount / duration / activityFreshness / currentToolDuration
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { OverlayHandle } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

/** TUI 引用（仅用 requestRender）—— 避免与 pi-coding-agent 的 TUI 类型冲突 */
type TuiRef = { requestRender: () => void };
import type { AgentProgress } from "../P1/spawn.js";
import type { SignalType } from "../P0/signal.js";
import {
	getStore,
	scheduleTerminationCleanup,
	recordSignal as storeRecordSignal,
	setProgress as storeSetProgress,
	type WorkerProgress,
} from "./renderers.js";

const WIDGET_KEY = "dteam-workers";
const MIN_ROW_WIDTH = 20;
const UPDATE_THROTTLE_MS = 1000;
const FULLSCREEN_REFRESH_MS = 500;
const TICK_INTERVAL_MS = 1000;
const MAX_TERMINAL_ROWS = 8;

// ── 信号类型 → emoji 映射 ──────────────────────────────────────

const SIGNAL_ICON: Record<SignalType, string> = {
	progress: "📡",
	blocked: "🚧",
	found: "🔍",
	help: "🆘",
};

// ── 类型定义 ──────────────────────────────────────────────────

/** 旧 WorkerWidgetState（兼容 showWorkerStatus 旧调用） */
export interface WorkerWidgetState {
	status: "pending" | "running" | "done" | "failed";
	agent?: string;
	task?: string;
	toolCount: number;
	currentTool?: string;
	elapsedMs: number;
}

/** 展开态所需的额外字段 */
export interface ExtendedProgressData {
	currentTool?: string;
	recentOutput?: string;
	tokenCount?: number;
	duration: number;
	activityFreshness: number;
	currentToolDuration?: number;
}

// ── 全局状态 ──────────────────────────────────────────────────

/** 当前展开态是否激活 */
let expandedActive = false;
/** 全屏覆盖层句柄 */
let fullscreenHandle: OverlayHandle | null = null;
/** 当前活跃的全屏组件（用于 invalidate 触发重绘） */
let activeFullscreenComponent: (Component & { dispose?(): void }) | null = null;
/** 最新 AgentProgress 数据（按 workerId 索引） */
const latestProgressByWorker = new Map<string, ExtendedProgressData>();
/** 最新 ExtensionContext */
let latestCtx: ExtensionContext | null = null;
/** 全屏刷新定时器 */
let fullscreenRefreshTimer: ReturnType<typeof setInterval> | null = null;
/** 折叠 widget 的全局 tick（1s 跳秒） */
let tickTimer: ReturnType<typeof setInterval> | null = null;
/** 当前活跃的 TUI（用于 requestRender） */
let activeTui: TuiRef | null = null;
/** 当前折叠 widget 的最新 WorkerProgress（按 workerId）+ lastUpdateTime（throttle） */
let lastUpdateTime = 0;
let pendingUpdate: { ctx: ExtensionContext; progress: WorkerProgress } | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;
/** 测试用：widget factory 返回的 component dispose 计数 */
let disposedCount = 0;

// ── 单行格式化函数 ──────────────────────────────────────────

/**
 * 格式化信号角标："📡×3" / "📡" / ""
 */
function formatSignalBadge(progress: WorkerProgress): string {
	if (!progress.lastSignal || progress.signalCount === 0) return "";
	const icon = SIGNAL_ICON[progress.lastSignal.type] ?? "📡";
	return progress.signalCount > 1 ? `${icon}×${progress.signalCount}` : icon;
}

/**
 * 格式化单行 worker 进度：
 *   "● build  实现功能  Tools:3 edit  5.0s  📡"
 *   "  ↳ step1/3 探索  2.1s  ✓"
 *
 * indent: 0=父, 2=子
 */
export function formatWorkerRow(
	progress: WorkerProgress,
	width: number,
	indent: number,
): string {
	const { role, task, toolCount, currentTool, status, elapsedMs, chainIndex, chainTotal } = progress;
	const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;

	const statusIcon: Record<typeof status, string> = {
		pending: "⏳",
		running: "●",
		done: "✓",
		failed: "✗",
	};
	const icon = statusIcon[status] ?? "?";

	const indentStr = " ".repeat(indent) + (indent > 0 ? "↳ " : "");
	const chainPrefix = chainIndex !== undefined && chainTotal !== undefined
		? `[${chainIndex}/${chainTotal}] `
		: "";
	const toolSuffix = currentTool ? ` · ${currentTool}` : "";
	const badge = formatSignalBadge(progress);

	const line = `${indentStr}${icon} ${role}  ${chainPrefix}${task}  T:${toolCount}${toolSuffix}  ${elapsed}${badge ? "  " + badge : ""}`;

	return truncateToWidth(line, width);
}

// ── 折叠态 Component：多 worker 列表 ─────────────────────────

/**
 * WorkerStatusList — 渲染多 worker 单行 + 嵌套缩进 + 信号角标
 * 取代旧的 WorkerStatusBox（单 worker bordered box）
 */
export class WorkerStatusList implements Component {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private theme: Theme,
	) {}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const all = Array.from(getStore().values());

		if (all.length === 0) {
			const line = this.theme.fg("muted", "(no workers)");
			this.cachedWidth = width;
			this.cachedLines = [truncateToWidth(line, width)];
			return this.cachedLines;
		}

		if (width < MIN_ROW_WIDTH) {
			// 宽度不足：每行只显示 workerId+status
			const lines = all.map((p) => {
				const icon = p.status === "running" ? "●" : p.status === "done" ? "✓" : p.status === "failed" ? "✗" : "○";
				return truncateToWidth(`${icon} ${p.workerId}`, width);
			});
			this.cachedWidth = width;
			this.cachedLines = lines;
			return this.cachedLines;
		}

		// 1. 找出所有"父" worker（无 parentWorkerId 的）
		// 2. 找出每个父下的子 worker
		const parents = all.filter((p) => !p.parentWorkerId);
		const children = all.filter((p) => p.parentWorkerId);

		const lines: string[] = [];

		// 按 startTime 排序父节点
		parents.sort((a, b) => a.startTime - b.startTime);

		// 限制最多 MAX_TERMINAL_ROWS 行
		const totalRows = parents.length + Math.min(children.length, MAX_TERMINAL_ROWS);
		const showAll = totalRows <= MAX_TERMINAL_ROWS;
		const parentBudget = showAll
			? parents.length
			: Math.max(0, MAX_TERMINAL_ROWS - Math.min(children.length, 3));

		const visibleParents = parents.slice(0, parentBudget);
		for (const parent of visibleParents) {
			lines.push(this.theme.fg("text", formatWorkerRow(parent, width, 0)));
			// 渲染此父的子 worker
			const kids = children.filter((c) => c.parentWorkerId === parent.workerId);
			kids.sort((a, b) => (a.chainIndex ?? 0) - (b.chainIndex ?? 0));
			for (const kid of kids) {
				lines.push(this.theme.fg("muted", formatWorkerRow(kid, width, 2)));
			}
		}

		// 如果还有未显示的子节点
		if (!showAll) {
			const shown = visibleParents.reduce((sum, p) => sum + children.filter((c) => c.parentWorkerId === p.workerId).length, 0);
			const remaining = children.length - shown;
			if (remaining > 0) {
				lines.push(this.theme.fg("muted", `  … +${remaining} more`));
			}
		}

		// 展开提示：引导用户用 /dteam command 触发 toggleWorkerExpanded
		// 不用快捷键——避免冲突 + 用户输入 / 时能看到 command 列表（可发现性）
		lines.push(this.theme.fg("muted", "Type /dteam to expand"));

		this.cachedWidth = width;
		this.cachedLines = lines;
		return this.cachedLines;
	}

	dispose(): void {
		disposedCount += 1;
		// 关键修复：清 tickTimer + activeTui，避免 setWidget 被新 factory 替换时旧 interval 泄漏（AC9 内存泄漏 FAIL）
		clearTick();
		activeTui = null;
	}
}

// ── 展开态 Component ─────────────────────────────────────────

/** 格式化持续时间 */
function formatDuration(ms: number): string {
	const seconds = Math.floor(ms / 1000);
	const minutes = Math.floor(seconds / 60);
	const remainingSeconds = seconds % 60;
	return minutes > 0 ? `${minutes}m ${remainingSeconds}s` : `${seconds}s`;
}

/** 格式化活动新鲜度 */
function formatFreshness(ts: number): string {
	const diff = Date.now() - ts;
	if (diff < 1000) return "just now";
	if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
	return `${Math.floor(diff / 60_000)}m ago`;
}

export class WorkerFullscreenView implements Component {
	private cachedWidth?: number;
	private cachedLines?: string[];

	constructor(
		private theme: Theme,
		private workerId: string,
	) {}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	/** 从 store 读最新数据并渲染 */
	private buildLines(width: number): string[] {
		const progress = getStore().get(this.workerId);
		const extended = latestProgressByWorker.get(this.workerId);

		if (!progress) {
			return [this.theme.fg("muted", `(worker ${this.workerId} not found)`)];
		}

		const { status, role, task, toolCount, elapsedMs, lastSignal, signalCount, finalError } = progress;
		const toolCountFromExtended = extended?.tokenCount !== undefined
			? toolCount
			: toolCount;

		const statusIcon: Record<typeof status, string> = {
			pending: "⏳",
			running: "●",
			done: "✓",
			failed: "✗",
		};
		const icon = statusIcon[status] ?? "?";

		const lines: string[] = [];
		const divider = "─".repeat(Math.max(1, width - 2));

		// 标题行
		const signalSuffix = lastSignal
			? ` │ ${SIGNAL_ICON[lastSignal.type]}${signalCount > 1 ? `×${signalCount}` : ""}`
			: "";
		const title = ` ${icon} ${role} │ ${status} │ ${formatDuration(elapsedMs)}${signalSuffix} `;
		lines.push(this.theme.fg("accent", truncateToWidth(title, width)));
		lines.push(this.theme.fg("borderMuted", divider));

		// Task
		lines.push(this.theme.fg("text", `Task: ${truncateToWidth(task ?? "(no task)", Math.max(1, width - 6))}`));
		lines.push("");

		// Current Tool
		const currentTool = extended?.currentTool ?? progress.currentTool;
		if (currentTool) {
			const toolLine = extended?.currentToolDuration
				? `Current Tool: ${currentTool} (${formatDuration(extended.currentToolDuration)})`
				: `Current Tool: ${currentTool}`;
			lines.push(this.theme.fg("warning", truncateToWidth(toolLine, width)));
		} else {
			lines.push(this.theme.fg("muted", "Current Tool: (none)"));
		}
		lines.push(this.theme.fg("borderMuted", divider));

		// Recent Output
		lines.push(this.theme.fg("text", `Recent Output (${toolCountFromExtended} tools):`));
		if (extended?.recentOutput) {
			const outputLines = extended.recentOutput.split("\n").slice(-8);
			for (const line of outputLines) {
				lines.push(this.theme.fg("muted", `  > ${truncateToWidth(line, Math.max(1, width - 4))}`));
			}
		} else {
			lines.push(this.theme.fg("muted", "  (no output yet)"));
		}
		lines.push(this.theme.fg("borderMuted", divider));

		// Token Count
		const tokenStr = extended?.tokenCount?.toLocaleString() ?? "—";
		lines.push(this.theme.fg("text", `Token Count: ${tokenStr}`));

		// Activity Freshness
		if (extended?.activityFreshness) {
			lines.push(this.theme.fg("text", `Activity: ${formatFreshness(extended.activityFreshness)}`));
		}

		// Final error (if failed)
		if (status === "failed" && finalError) {
			lines.push("");
			lines.push(this.theme.fg("error", `Error: ${truncateToWidth(finalError, Math.max(1, width - 8))}`));
		}

		lines.push("");
		lines.push(this.theme.fg("borderMuted", "[Ctrl+O] collapse"));

		return lines;
	}

	render(width: number): string[] {
		if (this.cachedLines && this.cachedWidth === width) {
			return this.cachedLines;
		}

		const lines = this.buildLines(width);
		this.cachedWidth = width;
		this.cachedLines = lines;
		return lines;
	}

	dispose(): void {
		disposedCount += 1;
		// 关键修复：清 fullscreenRefreshTimer，避免 setWidget 被新 factory 替换时旧 interval 泄漏（AC9 内存泄漏 FAIL）
		if (fullscreenRefreshTimer) {
			clearInterval(fullscreenRefreshTimer);
			fullscreenRefreshTimer = null;
		}
	}
}

// ── 信号桥接（bus → store） ────────────────────────────────────

/** 已安装的 bus 引用（避免重复安装） */
let installedBusRef: unknown = null;
/** 已安装的取消订阅函数列表 */
const signalBridgeUnsubs: Array<() => void> = [];

/**
 * 从 signal data 提取嵌套/元数据并更新 store
 */
function applySignalToStore(workerId: string, data: Record<string, unknown>): void {
	const existing = getStore().get(workerId);
	const now = Date.now();

	if (!existing) {
		// 不存在的 workerId：创建一个初始记录
		const newRecord: WorkerProgress = {
			workerId,
			role: (data.role as string) ?? "unknown",
			status: (data.status as WorkerProgress["status"]) ?? "running",
			task: (data.task as string) ?? "",
			toolCount: 0,
			startTime: now,
			elapsedMs: 0,
			signalCount: 0,
			parentWorkerId: data.parentWorkerId as string | undefined,
			chainIndex: data.chainIndex as number | undefined,
			chainTotal: data.chainTotal as number | undefined,
			isChainStep: data.isChainStep as boolean | undefined,
		};
		storeSetProgress(newRecord);
	} else {
		// 已存在：更新嵌套/状态
		if (data.parentWorkerId !== undefined) existing.parentWorkerId = data.parentWorkerId as string;
		if (data.role !== undefined) existing.role = data.role as string;
		if (data.task !== undefined) existing.task = data.task as string;
		if (data.chainIndex !== undefined) {
			existing.chainIndex = data.chainIndex as number;
			existing.isChainStep = true;
		}
		if (data.chainTotal !== undefined) existing.chainTotal = data.chainTotal as number;
		if (data.isChainStep !== undefined) existing.isChainStep = data.isChainStep as boolean;
		if (data.status !== undefined) existing.status = data.status as WorkerProgress["status"];
	}
}

/**
 * 安装信号桥接：bus 信号 → store 更新 + 信号角标
 * 调用一次（重入会忽略）
 */
export function installSignalBridge(bus: {
	on: (type: string, listener: (signal: { workerId: string; data: Record<string, unknown> }) => void) => () => void;
}): void {
	if (installedBusRef === bus) return; // 幂等
	installedBusRef = bus;

	const handlerTypes = ["progress", "blocked", "found", "help"] as const;
	for (const type of handlerTypes) {
		const unsub = bus.on(type, (signal) => {
			const { workerId, data } = signal;
			// 1. 更新嵌套/元数据
			applySignalToStore(workerId, data);
			// 2. 更新信号角标（lastSignal + signalCount）
			storeRecordSignal(workerId, type);
			// 3. 触发 TUI 重绘
			activeTui?.requestRender();
		});
		signalBridgeUnsubs.push(unsub);
	}
}

/**
 * 卸载信号桥接（测试用 / session shutdown）
 */
export function uninstallSignalBridge(): void {
	for (const u of signalBridgeUnsubs) {
		try { u(); } catch { /* ignore */ }
	}
	signalBridgeUnsubs.length = 0;
	installedBusRef = null;
}

// ── Widget 控制 ──────────────────────────────────────────────────

/**
 * 启动折叠 widget 的全局 tick（1s 跳秒 + 触发重绘）
 * 第一次调用时启动，disposeWidgetState() 时清掉
 */
function ensureTick(): void {
	if (tickTimer) return;
	tickTimer = setInterval(() => {
		// 更新 store 中所有 worker 的 elapsedMs
		const now = Date.now();
		for (const w of getStore().values()) {
			if (w.status === "running") {
				w.elapsedMs = now - w.startTime;
			}
		}
		// 触发 TUI 重绘
		activeTui?.requestRender();
	}, TICK_INTERVAL_MS);
}

function clearTick(): void {
	if (tickTimer) {
		clearInterval(tickTimer);
		tickTimer = null;
	}
}

/**
 * 显示 worker 状态 widget（节流，避免 flicker）
 * @param workerId 必传：用入参 workerId 作为 store 主键（不再从 state 取）
 * @deprecated 优先使用 updateAgentProgress(workerId, progress)
 */
export function showWorkerStatus(ctx: ExtensionContext, workerId: string, state: WorkerWidgetState): void {
	if (!ctx.hasUI) return;

	// 从 store 拿现有记录（如果有），合并 state
	const existing = getStore().get(workerId);
	const merged: WorkerProgress = existing ?? {
		workerId,
		role: state.agent ?? "unknown",
		status: state.status,
		task: state.task ?? "",
		toolCount: state.toolCount,
		currentTool: state.currentTool,
		startTime: Date.now() - state.elapsedMs,
		elapsedMs: state.elapsedMs,
		signalCount: 0,
	};
	merged.status = state.status;
	merged.task = state.task ?? merged.task;
	merged.toolCount = state.toolCount;
	merged.currentTool = state.currentTool;
	merged.elapsedMs = state.elapsedMs;
	merged.role = state.agent ?? merged.role;
	setProgress(merged);

	// 如果展开态已激活，不覆盖折叠态 widget
	if (expandedActive) return;

	const now = Date.now();
	const elapsed = now - lastUpdateTime;

	if (elapsed >= UPDATE_THROTTLE_MS) {
		lastUpdateTime = now;
		renderWidget(ctx);
	} else {
		pendingUpdate = { ctx, progress: merged };
		if (!throttleTimer) {
			throttleTimer = setTimeout(() => {
				throttleTimer = null;
				if (pendingUpdate) {
					const { ctx: pendingCtx } = pendingUpdate;
					pendingUpdate = null;
					lastUpdateTime = Date.now();
					renderWidget(pendingCtx);
				}
			}, UPDATE_THROTTLE_MS - elapsed);
		}
	}
}

function setProgress(p: WorkerProgress): void {
	getStore().set(p.workerId, p);
}

/**
 * 更新 AgentProgress 数据（新签名：workerId 必传）
 * wrapWorker 通过闭包把 outer workerId 绑进来
 */
export function updateAgentProgress(workerId: string, progress: AgentProgress): void {
	const now = Date.now();
	const existing = getStore().get(workerId);
	const extended: ExtendedProgressData = {
		currentTool: progress.currentTool,
		recentOutput: progress.recentOutput,
		tokenCount: progress.tokenCount,
		duration: now - progress.startTime,
		activityFreshness: now,
		currentToolDuration: progress.currentTool ? now - progress.startTime : undefined,
	};
	latestProgressByWorker.set(workerId, extended);

	// 更新 store 中的 elapsedMs
	if (existing) {
		existing.elapsedMs = now - existing.startTime;
		existing.currentTool = progress.currentTool;
		if (progress.status === "done" || progress.status === "error" || progress.status === "aborted") {
			existing.toolCount += 1; // final tool call
		}
	}

	// 通知 TUI 重绘（折叠态 + 展开态都会收到）
	activeTui?.requestRender();
}

/**
 * 标记 worker 终态 + 调度清理
 */
export function registerWorkerTerminated(
	workerId: string,
	finalStatus: "done" | "failed",
	error?: string,
): void {
	const existing = getStore().get(workerId);
	if (existing) {
		existing.status = finalStatus;
		existing.elapsedMs = Date.now() - existing.startTime;
		if (error) existing.finalError = error;
	} else {
		getStore().set(workerId, {
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
	}
	scheduleTerminationCleanup(workerId);
	activeTui?.requestRender();
}

/**
 * 清除所有 worker widget（session shutdown）
 */
export function clearAllWorkerWidgets(): void {
	resetThrottleState();
	resetExpandedState();
	getStore().clear();
	latestProgressByWorker.clear();
	clearTick();
	activeTui = null;
}

/**
 * 清除指定 worker 状态 widget
 */
export function clearWorkerStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	resetThrottleState();
	// 不清 store：可能还有别的 worker 在跑

	// 如果展开态激活，先关闭
	if (expandedActive) {
		closeFullscreen();
	}

	ctx.ui.setWidget(WIDGET_KEY, undefined);
}

/**
 * 重置节流状态（供测试用）
 */
export function resetThrottleState(): void {
	if (throttleTimer) {
		clearTimeout(throttleTimer);
		throttleTimer = null;
	}
	pendingUpdate = null;
	lastUpdateTime = 0;
}

/**
 * 重置展开态（供测试用）
 */
export function resetExpandedState(): void {
	expandedActive = false;
	fullscreenHandle = null;
	activeFullscreenComponent = null;
	latestProgressByWorker.clear();
	latestCtx = null;
	if (fullscreenRefreshTimer) {
		clearInterval(fullscreenRefreshTimer);
		fullscreenRefreshTimer = null;
	}
}

/** 获取当前展开态（供测试用） */
export function isExpanded(): boolean {
	return expandedActive;
}

/** 获取 dispose 调用次数（供测试用） */
export function getDisposedCount(): number {
	return disposedCount;
}

/** 重置 dispose 计数（供测试用） */
export function resetDisposedCount(): void {
	disposedCount = 0;
}

/**
 * 渲染折叠态 widget（内部函数）
 * 工厂模式：捕获 tui + theme，启动 tick
 */
function renderWidget(ctx: ExtensionContext): void {
	ctx.ui.setWidget(WIDGET_KEY, (tui, theme) => {
		// 抓住 tui（用于 requestRender）
		activeTui = tui;
		// 启动 tick
		ensureTick();
		return new WorkerStatusList(theme);
	});
}

// ── 全屏展开/折叠切换 ──────────────────────────────────────────

/**
 * 关闭全屏覆盖层
 */
function closeFullscreen(): void {
	if (fullscreenRefreshTimer) {
		clearInterval(fullscreenRefreshTimer);
		fullscreenRefreshTimer = null;
	}
	activeFullscreenComponent = null;
	if (fullscreenHandle) {
		try { fullscreenHandle.hide(); } catch { /* ignore */ }
		fullscreenHandle = null;
	}
	expandedActive = false;

	// 恢复折叠态 widget
	if (latestCtx) {
		renderWidget(latestCtx);
	}
}

/**
 * 切换折叠/展开状态（Ctrl+O 触发）
 */
export function toggleWorkerExpanded(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	if (expandedActive) {
		closeFullscreen();
		return;
	}

	// 需要有 worker 状态才能展开
	const store = getStore();
	if (store.size === 0) return;

	// 取第一个 worker 作为"焦点"（实际应支持选定）
	let focusWorkerId: string | undefined;
	for (const [wid, p] of store.entries()) {
		if (p.status === "running") {
			focusWorkerId = wid;
			break;
		}
	}
	if (!focusWorkerId) {
		focusWorkerId = store.keys().next().value;
	}
	if (!focusWorkerId) return;

	latestCtx = ctx;
	expandedActive = true;

	// 移除折叠态 widget
	ctx.ui.setWidget(WIDGET_KEY, undefined);

	// 弹出全屏覆盖层
	void ctx.ui.custom(
		(tui, theme, _keybindings, _done) => {
			const component = new WorkerFullscreenView(theme, focusWorkerId!);

			activeFullscreenComponent = component;

			// 定期刷新（进度数据变化时触发重绘）
			fullscreenRefreshTimer = setInterval(() => {
				if (!expandedActive) return;
				if (activeFullscreenComponent) {
					activeFullscreenComponent.invalidate();
					tui.requestRender();
				}
			}, FULLSCREEN_REFRESH_MS);

			return component;
		},
		{
			overlay: true,
			overlayOptions: {
				anchor: "center",
				width: "90%",
				maxHeight: "80%",
			},
			onHandle: (handle) => {
				fullscreenHandle = handle;
			},
		},
	);
}
