/**
 * Worker 状态 Widget — 在 TUI 中显示 worker 实时状态
 *
 * 三层状态：
 *   - 折叠态：多 worker 单行 + 2 空格缩进 + ↳ + 信号角标
 *   - 展开态：多 worker Tab 面板（/dteam 触发），每个主 worker 一个 tab，嵌套在内容底部 ↳ 缩进
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
import {
	Box,
	Container,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	visibleWidth,
} from "@earendil-works/pi-tui";

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
/** Tab Panel 关闭出口：factory 内部赋值 done，外部 closeWorkerPanel 调它触发 inline widget 卸载 */
let currentPanelDone: ((result: PanelResult) => void) | null = null;
/** 最新 AgentProgress 数据（按 workerId 索引） */
const latestProgressByWorker = new Map<string, ExtendedProgressData>();
/** 最新 ExtensionContext */
let latestCtx: ExtensionContext | null = null;
/** Panel 刷新定时器（模块级单例，多 panel 不重复创建） */
let panelRefreshTimer: ReturnType<typeof setInterval> | null = null;
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

// ── Tab 面板纯渲染函数（供 showWorkerPanel 与单测复用） ──────────

/**
 * 构建 Tab 栏文本（多 worker 切换用）。
 * 例： `[● w-1] [○ w-2] [+ 3 more]`
 *
 * - parents 必须是父 worker 列表（无 parentWorkerId）
 * - currentIdx 是当前选中 tab 索引（-1 表示未选中）
 * - 超出 MAX_TAB_LABELS 折叠为 `[+N more]`
 */
export function buildTabBar(
	theme: Theme,
	parents: WorkerProgress[],
	currentIdx: number,
	width: number,
): string {
	if (parents.length === 0) {
		return theme.fg("muted", "(no workers)");
	}
	const MAX_TAB_LABELS = 10;
	const visibleCount = Math.min(parents.length, MAX_TAB_LABELS);
	const parts: string[] = [];

	for (let i = 0; i < visibleCount; i++) {
		const w = parents[i];
		const isActive = i === currentIdx;
		const icon = w.status === "running" ? "●" : w.status === "done" ? "✓" : w.status === "failed" ? "✗" : "○";
		const label = ` ${icon} ${w.workerId} `;
		// active tab 用 selectedBg 高亮（theme 装饰，没有 selectedBg 时降级为 accent）
		const text = isActive ? label : label;
		parts.push(isActive ? theme.fg("accent", text) : theme.fg("muted", text));
	}

	if (parents.length > MAX_TAB_LABELS) {
		parts.push(theme.fg("muted", ` [+${parents.length - MAX_TAB_LABELS} more]`));
	}

	return truncateToWidth(parts.join(" "), width);
}

/**
 * 构建 Tab 内容（当前 worker 详情 + 嵌套区域）。
 *
 * - currentWorker：当前选中的 worker（父或 Enter 进入的子）
 * - children：该 worker 的子 worker 列表（currentWorker.parentWorkerId 为空时才有意义）
 * - extended：latestProgressByWorker 中的扩展数据
 * - parentWorkerId：当显示子 worker 详情时，回到父 tab 的提示
 *
 * 返回 string[] 每行已带 ANSI 颜色。
 */
export function buildTabContent(
	theme: Theme,
	currentWorker: WorkerProgress,
	children: WorkerProgress[],
	extended: ExtendedProgressData | undefined,
	width: number,
	options: { showBackToParent?: boolean } = {},
): string[] {
	const lines: string[] = [];
	// divider 跟内容等宽（之前用 width-2 导致错位）
	const divider = theme.fg("borderMuted", "─".repeat(Math.max(1, width)));

	// 1. 顶部"返回父"提示（子 worker 详情时显示）
	if (options.showBackToParent) {
		lines.push(theme.fg("warning", truncateToWidth("◀ Back to parent (Esc)", width)));
	}

	// 2. 标题行
	const statusIcon: Record<WorkerProgress["status"], string> = {
		pending: "⏳",
		running: "●",
		done: "✓",
		failed: "✗",
	};
	const icon = statusIcon[currentWorker.status] ?? "?";
	const signalSuffix = currentWorker.lastSignal
		? ` │ ${SIGNAL_ICON[currentWorker.lastSignal.type]}${currentWorker.signalCount > 1 ? `×${currentWorker.signalCount}` : ""}`
		: "";
	const title = ` ${icon} ${currentWorker.role} │ ${currentWorker.status} │ ${formatDuration(currentWorker.elapsedMs)}${signalSuffix} `;
	// 截断后补空格到 width，避免内容行比 divider 短造成错位（考虑 ANSI 颜色码）
	const truncatedTitle = truncateToWidth(title, width);
	const titleVisibleWidth = visibleWidth(truncatedTitle);
	const paddedTitle = titleVisibleWidth < width
		? truncatedTitle + " ".repeat(width - titleVisibleWidth)
		: truncatedTitle;
	lines.push(theme.fg("accent", paddedTitle));
	lines.push(divider);

	// 3. Task
	const task = currentWorker.task || "(no task)";
	lines.push(theme.fg("text", `任务: ${truncateToWidth(task, Math.max(1, width - 6))}`));
	lines.push("");

	// 4. Current Tool
	const currentTool = extended?.currentTool ?? currentWorker.currentTool;
	if (currentTool) {
		const toolLine = extended?.currentToolDuration
			? `当前工具: ${currentTool} (${formatDuration(extended.currentToolDuration)})`
			: `当前工具: ${currentTool}`;
		lines.push(theme.fg("warning", truncateToWidth(toolLine, width)));
	} else {
		lines.push(theme.fg("muted", "当前工具: 无"));
	}
	lines.push(divider);

	// 5. Recent Output
	lines.push(theme.fg("text", `最近输出 (${currentWorker.toolCount} 次工具调用):`));
	if (extended?.recentOutput) {
		const outputLines = extended.recentOutput.split("\n").slice(-8);
		for (const line of outputLines) {
			lines.push(theme.fg("muted", `  > ${truncateToWidth(line, Math.max(1, width - 4))}`));
		}
	} else {
		lines.push(theme.fg("muted", "  （暂无输出）"));
	}
	lines.push(divider);

	// 6. Token Count + Activity
	const tokenStr = extended?.tokenCount?.toLocaleString() ?? "—";
	lines.push(theme.fg("text", `Token 数量: ${tokenStr}`));
	if (extended?.activityFreshness) {
		lines.push(theme.fg("text", `活动: ${formatFreshness(extended.activityFreshness)}`));
	}

	// 7. Final error
	if (currentWorker.status === "failed" && currentWorker.finalError) {
		lines.push("");
		lines.push(theme.fg("error", `错误: ${truncateToWidth(currentWorker.finalError, Math.max(1, width - 8))}`));
	}

	// 8. 嵌套 worker section（子 worker 列表）
	if (children.length > 0) {
		lines.push("");
		lines.push(divider);
		lines.push(theme.fg("text", `嵌套 worker（${children.length}）:`));
		lines.push(...formatNestedWorkers(theme, currentWorker, children, width));
		lines.push(theme.fg("dim", truncateToWidth("  按 Enter 查看子 worker 详情", width)));
	}

	return lines;
}

/**
 * 格式化嵌套 worker 列表（用 ↳ 缩进显示在 Tab 内容底部）。
 * 用于：buildTabContent 内部 + 单测。
 */
export function formatNestedWorkers(
	theme: Theme,
	parent: WorkerProgress,
	children: WorkerProgress[],
	width: number,
): string[] {
	const lines: string[] = [];
	// 按 chainIndex 排序，缺失则按 startTime
	const sorted = [...children].sort((a, b) => {
		if (a.chainIndex !== undefined && b.chainIndex !== undefined) {
			return a.chainIndex - b.chainIndex;
		}
		return a.startTime - b.startTime;
	});
	for (const kid of sorted) {
		// 直接复用 formatWorkerRow（indent=2 → 2 空格 + ↳）
		lines.push(theme.fg("muted", formatWorkerRow(kid, width, 2)));
	}
	// 引用 parent 避免 lint 警告（实际不需要，但函数签名清晰）
	void parent;
	return lines;
}

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
 *   "● build  实现功能  工具:3 edit  5.0s  📡"
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

	const line = `${indentStr}${icon} ${role}  ${chainPrefix}${task}  工具:${toolCount}${toolSuffix}  ${elapsed}${badge ? "  " + badge : ""}`;

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

		// 展开提示：引导用户用 /dteam command 触发 showWorkerPanel
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

// ── 展开态辅助函数（与 buildTabContent 配合使用） ─────────────────────

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
		closeWorkerPanel();
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
 * - 清 panelRefreshTimer、currentPanelDone
 * - 清 latestProgressByWorker + 从 store 移除对应记录（防 stale 污染）
 * - 重置 expandedActive / latestCtx
 */
export function resetExpandedState(): void {
	expandedActive = false;
	currentPanelDone = null;
	latestCtx = null;

	// 清最新进度 Map + 同步从 store 移除
	const store = getStore();
	for (const wid of latestProgressByWorker.keys()) {
		store.delete(wid);
	}
	latestProgressByWorker.clear();

	if (panelRefreshTimer) {
		clearInterval(panelRefreshTimer);
		panelRefreshTimer = null;
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

// ── Tab 面板：多 worker 展开/折叠切换 ─────────────────────────────────

/** Panel 返回结果 */
export type PanelResult =
	| { action: "select-child"; childId: string }
	| { action: "back-to-parent" }
	| { action: "close" }
	| null;

/**
 * 关闭 Tab Panel（inline widget 模式）
 *
 * 流程：
 * 1. 调 currentPanelDone(null) 触发 TUI 卸载 inline component
 * 2. 清 currentPanelDone / panelRefreshTimer（避免悬挂引用 + 定时器泄漏）
 * 3. 同步从 store 移除 latestProgressByWorker 中的 worker（避免 stale 污染）
 * 4. 重置展开态
 * 5. 恢复折叠态 widget（用户在 /dteam 关闭后仍能看到底部状态行）
 */
function closeWorkerPanel(): void {
	// 1. 触发 inline widget 关闭（factory 内调 done(null)）
	if (currentPanelDone) {
		try { currentPanelDone(null); } catch { /* ignore */ }
		currentPanelDone = null;
	}

	// 2. 清 panelRefreshTimer（避免多 panel 叠加时泄漏）
	if (panelRefreshTimer) {
		clearInterval(panelRefreshTimer);
		panelRefreshTimer = null;
	}

	// 3. 同步从 store 移除 latestProgressByWorker 中的 worker（避免 stale 污染）
	const store = getStore();
	for (const wid of latestProgressByWorker.keys()) {
		store.delete(wid);
	}
	latestProgressByWorker.clear();

	// 4. 重置展开态
	expandedActive = false;

	// 5. 恢复折叠态 widget
	if (latestCtx) {
		renderWidget(latestCtx);
	}
}

/**
 * 显示多 worker Tab 面板（/dteam command 触发）
 */
export async function showWorkerPanel(ctx: ExtensionContext): Promise<void> {
	if (!ctx.hasUI) return;

	// 幂等：已展开则关闭（重入口保护）
	if (expandedActive) {
		closeWorkerPanel();
		return;
	}

	// 不管 store 是否为空，都弹 panel（AC9：空 store 也显示提示，不静默失败）
	const store = getStore();

	// 仅看父 worker（无 parentWorkerId）作为 tab
	const parents = Array.from(store.values()).filter((p) => !p.parentWorkerId);
	if (parents.length === 0) {
		// 根据 store 状态选文案：
		// - store.size === 0: 真空 · 提示“未启动 worker”
		// - store.size > 0 但全是嵌套子 worker: 异常 · 提示“无主 worker”
		const emptyMsg = store.size === 0
			? "  （无 worker 正在工作）"
			: "  （无父 worker 正在工作）";
		await ctx.ui.custom<PanelResult>(
			(_tui, theme, _kb, done) => {
				const boxW = Math.min(56, Math.max(30, 56)); // 默认 56 列宽
				const innerW = boxW - 4; // Box paddingX=2 两侧
				const divider = "─".repeat(Math.max(1, innerW));

				const box = new Box(
					2, // paddingX
					1, // paddingY
					(s) => theme.bg("customMessageBg", s), // 不透明背景
				);
				box.addChild(new Text(theme.fg("accent", " 📊 dteam worker 进度 "), 0, 0));
				box.addChild(new Text(theme.fg("borderMuted", divider), 0, 0));
				box.addChild(new Text(theme.fg("muted", emptyMsg), 0, 0));
				box.addChild(new Text("", 0, 0));
				box.addChild(new Text(theme.fg("dim", "  启动 worker 试试："), 0, 0));
				box.addChild(new Text(theme.fg("dim", "    /dteam run <目标描述>"), 0, 0));
				box.addChild(new Text(theme.fg("borderMuted", divider), 0, 0));
				box.addChild(new Text(
					theme.fg("borderMuted", "  [Esc/q/Ctrl+C] 关闭"),
					1,
					0,
				));
				// 暴露 done 出口供 closeWorkerPanel 外部触发
				currentPanelDone = done;
				return {
					render: (w: number) => box.render(w),
					invalidate: () => box.invalidate?.(),
					handleInput: (data: string) => {
						if (data === "q" || matchesKey(data, Key.escape) || matchesKey(data, Key.ctrl("c"))) {
							done(null);
						}
					},
					dispose: () => { box.clear(); currentPanelDone = null; },
				};
			},
			// inline 模式：无 overlay，面板渲染在信息流中
		);
		expandedActive = true;
		latestCtx = ctx;
		ctx.ui.setWidget(WIDGET_KEY, undefined);
		return;
	}

	latestCtx = ctx;
	expandedActive = true;

	// 移除折叠态 widget
	ctx.ui.setWidget(WIDGET_KEY, undefined);

	await ctx.ui.custom<PanelResult>(
		(tui, theme, _keybindings, done) => {
			// 暴露 done 出口供 closeWorkerPanel 外部触发
			currentPanelDone = done;
			// ── 闭包状态 ──
			let currentTabIdx = 0;
			let selectedChildId: string | undefined = undefined;
			const box = new Box(
				2, // paddingX
				1, // paddingY
				(s) => theme.bg("customMessageBg", s), // 不透明背景
			);
			let panelInnerW = 72; // rebuild 时根据 tui.columns 更新

			// 找出当前 tab 的 child worker 列表
			function getCurrentChildren(): WorkerProgress[] {
				const all = Array.from(getStore().values());
				if (selectedChildId) {
					// 在子详情页：以子 worker 为"当前"，但仍以原父的 child 列表为 children
					const originalParent = all.find((p) => p.workerId === getCurrentParentId());
					if (!originalParent) return [];
					return all.filter((c) => c.parentWorkerId === originalParent.workerId);
				}
				const current = all.filter((p) => !p.parentWorkerId).sort((a, b) => a.startTime - b.startTime)[currentTabIdx];
				if (!current) return [];
				return all.filter((c) => c.parentWorkerId === current.workerId);
			}

			// 取得当前 tab 顶级 worker 的 id（主 tab 或父 tab）
			function getCurrentParentId(): string | undefined {
				if (selectedChildId) return selectedChildId; // 子详情时仍保留原父
				const all = Array.from(getStore().values());
				const sorted = all.filter((p) => !p.parentWorkerId).sort((a, b) => a.startTime - b.startTime);
				return sorted[currentTabIdx]?.workerId;
			}

			// 取得当前显示的 worker 记录
			function getCurrentWorker(): WorkerProgress | undefined {
				if (selectedChildId) return getStore().get(selectedChildId);
				const all = Array.from(getStore().values());
				const sorted = all.filter((p) => !p.parentWorkerId).sort((a, b) => a.startTime - b.startTime);
				return sorted[currentTabIdx];
			}

			// rebuild box 内容
			function rebuild() {
				// Box.clear() 会自动 dispose 各子 component
				box.clear();

				const all = Array.from(getStore().values());
				panelInnerW = Math.min(76, Math.max(30, 72)); // 固定默认值，Box 会自适应
				const parentsSorted = all.filter((p) => !p.parentWorkerId).sort((a, b) => a.startTime - b.startTime);

				// 1. 标题行
				box.addChild(new Text(theme.fg("accent", " 📊 dteam worker progress "), 0, 0));

				// 2. Tab 栏
				box.addChild(new Text(
					"  " + buildTabBar(theme, parentsSorted, currentTabIdx, panelInnerW),
					0, 0,
				));

				// 3. 分隔线（动态宽度）
				box.addChild(new Text(theme.fg("borderMuted", "─".repeat(Math.max(1, panelInnerW))), 0, 0));

				// 4. Tab 内容
				const currentWorker = getCurrentWorker();
				if (currentWorker) {
					const extended = latestProgressByWorker.get(currentWorker.workerId);
					const children = getCurrentChildren();
					const contentLines = buildTabContent(
						theme,
						currentWorker,
						children,
						extended,
						panelInnerW,
						{ showBackToParent: !!selectedChildId },
					);
					for (const line of contentLines) {
						box.addChild(new Text(line, 0, 0));
					}
				} else {
					box.addChild(new Text(theme.fg("muted", "  (worker not found)"), 0, 0));
				}

				// 5. 底部提示
				box.addChild(new Text("", 0, 0));
				box.addChild(new Text(
					theme.fg("borderMuted", "  [Tab/⇧Tab · ←/→] switch · [Enter] child · [Esc/q/Ctrl+C] close"),
					0, 0,
				));
			}

			// 初次填充
			rebuild();

			// 500ms 跳秒（复用模块级单例 timer）
			// 先清旧 timer 避免多 panel 叠加
			if (panelRefreshTimer) clearInterval(panelRefreshTimer);
			panelRefreshTimer = setInterval(() => {
				if (!expandedActive) return;
				rebuild();
				tui.requestRender();
			}, FULLSCREEN_REFRESH_MS);

			// 键盘路由
			function handleInput(data: string) {
				const all = Array.from(getStore().values());
				const parentsSorted = all.filter((p) => !p.parentWorkerId).sort((a, b) => a.startTime - b.startTime);
				const totalTabs = parentsSorted.length;

				// 关闭快捷键
				if (matchesKey(data, Key.escape) || data === "q" || matchesKey(data, Key.ctrl("c"))) {
					if (selectedChildId) {
						// 在子详情页：Esc 先返回父，不关闭 panel
						selectedChildId = undefined;
						rebuild();
						tui.requestRender();
						return;
					}
					done({ action: "close" });
					return;
				}

				// 子详情页时：Right/Left/Tab 也可以返回父
				if (selectedChildId) {
					if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
						selectedChildId = undefined;
						rebuild();
						tui.requestRender();
						return;
					}
					if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
						selectedChildId = undefined;
						rebuild();
						tui.requestRender();
						return;
					}
				}

				// Tab 切换
				if (matchesKey(data, Key.tab) || matchesKey(data, Key.right)) {
					if (totalTabs === 0) return;
					currentTabIdx = (currentTabIdx + 1) % totalTabs;
					selectedChildId = undefined;
					rebuild();
					tui.requestRender();
					return;
				}
				if (matchesKey(data, Key.shift("tab")) || matchesKey(data, Key.left)) {
					if (totalTabs === 0) return;
					currentTabIdx = (currentTabIdx - 1 + totalTabs) % totalTabs;
					selectedChildId = undefined;
					rebuild();
					tui.requestRender();
					return;
				}

				// Enter：进入子 worker 详情
				if (matchesKey(data, Key.enter)) {
					const children = getCurrentChildren();
					if (children.length > 0) {
						// 选中第一个 child（简化：可后续加 child 列表光标）
						selectedChildId = children[0].workerId;
						rebuild();
						tui.requestRender();
						done({ action: "select-child", childId: selectedChildId });
						return;
					}
				}
			}

			return {
				render: (width: number) => box.render(width),
				invalidate: () => box.invalidate?.(),
				handleInput,
				dispose: () => {
					disposedCount += 1;
					// dispose 兑底清理：清 timer + done 出口 + 折叠 widget 恢复
					// 避免 Pi 内部清理 widget 时 timer 泄漏
					if (panelRefreshTimer) {
						clearInterval(panelRefreshTimer);
						panelRefreshTimer = null;
					}
					currentPanelDone = null;
					expandedActive = false;
					// 恢复折叠 widget（如果最新 ctx 还在）
					if (latestCtx) {
						latestCtx.ui.setWidget(WIDGET_KEY, (_tui, theme) =>
							new WorkerStatusList(theme),
					);
				}
			},
		};
	},
{
	overlay: true,
	overlayOptions: { anchor: "center", width: 80, maxHeight: "70%" },
},
);
}
