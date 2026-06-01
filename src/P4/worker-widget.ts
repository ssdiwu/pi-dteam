/**
 * Worker 状态 Widget — 在 TUI 中显示 worker 实时状态
 *
 * 两种模式：
 *   - 折叠态：bordered box 显示基础信息（agent/task/tools/elapsed）
 *   - 展开态：全屏覆盖层显示 AgentProgress 详细信息（Ctrl+O 切换）
 *
 * 字段映射：currentTool / recentOutput / tokenCount / duration / activityFreshness / currentToolDuration
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import type { OverlayHandle } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { AgentProgress } from "../P1/spawn.js";

const WIDGET_KEY = "dteam-worker";
const MIN_BOX_WIDTH = 20;
const UPDATE_THROTTLE_MS = 1000;
const FULLSCREEN_REFRESH_MS = 500;

// ── 类型定义 ──────────────────────────────────────────────────

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
/** 最新 AgentProgress 数据 */
let latestProgress: ExtendedProgressData | null = null;
/** 最新 WorkerWidgetState（折叠态用） */
let latestWidgetState: WorkerWidgetState | null = null;
/** 最新 ExtensionContext */
let latestCtx: ExtensionContext | null = null;
/** 全屏刷新定时器 */
let fullscreenRefreshTimer: ReturnType<typeof setInterval> | null = null;

// ── 折叠态 Component ─────────────────────────────────────────

class WorkerStatusBox implements Component {
	constructor(
		private theme: Theme,
		private state: WorkerWidgetState,
	) {}

	invalidate(): void {}

	render(width: number): string[] {
		if (width < MIN_BOX_WIDTH) {
			return [truncateToWidth(`worker: ${this.state.status}`, width)];
		}

		const { status, agent, task, toolCount, currentTool, elapsedMs } = this.state;
		const elapsed = `${(elapsedMs / 1000).toFixed(1)}s`;

		const statusIcon: Record<string, string> = {
			pending: "⏳",
			running: "🔄",
			done: "✅",
			failed: "❌",
		};

		const icon = statusIcon[status] ?? "❓";
		const title = ` worker ── ${icon} ${status} `;
		const contentWidth = width - 4;

		const lines = [
			`Agent: ${agent ?? "unknown"}`,
			`Task: ${truncateToWidth(task ?? "(no task)", contentWidth - 6)}`,
			`Tools: ${toolCount}${currentTool ? ` (current: ${currentTool})` : ""}`,
			`Elapsed: ${elapsed}`,
		];

		return [
			this.topBorder(title, width),
			...lines.map((line) => this.contentLine(line, contentWidth)),
			this.bottomBorder(width),
		];
	}

	private topBorder(title: string, width: number): string {
		const rightWidth = Math.max(1, width - visibleWidth(title) - 2);
		return this.theme.fg("borderMuted", `╭${title}${"─".repeat(rightWidth)}╮`);
	}

	private bottomBorder(width: number): string {
		return this.theme.fg("borderMuted", `╰${"─".repeat(width - 2)}╯`);
	}

	private contentLine(line: string, contentWidth: number): string {
		const padding = " ".repeat(Math.max(0, contentWidth - visibleWidth(line)));
		return [
			this.theme.fg("borderMuted", "│ "),
			this.theme.fg("text", line),
			padding,
			this.theme.fg("borderMuted", " │"),
		].join("");
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
		private state: WorkerWidgetState,
		private progress: ExtendedProgressData | null,
	) {}

	invalidate(): void {
		this.cachedWidth = undefined;
		this.cachedLines = undefined;
	}

	updateData(state: WorkerWidgetState, progress: ExtendedProgressData | null): void {
		this.state = state;
		this.progress = progress;
		this.invalidate();
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

	private buildLines(width: number): string[] {
		const { status, agent, task, toolCount, elapsedMs } = this.state;
		const progress = this.progress;

		const statusIcon: Record<string, string> = {
			pending: "⏳",
			running: "🔄",
			done: "✅",
			failed: "❌",
		};
		const icon = statusIcon[status] ?? "❓";

		const lines: string[] = [];
		const divider = "─".repeat(Math.max(1, width - 2));

		// 标题行
		const title = ` ${icon} Worker: ${agent ?? "unknown"} │ ${status} │ ${formatDuration(elapsedMs)} `;
		lines.push(this.theme.fg("accent", truncateToWidth(title, width)));
		lines.push(this.theme.fg("borderMuted", divider));

		// Task
		lines.push(this.theme.fg("text", `Task: ${truncateToWidth(task ?? "(no task)", Math.max(1, width - 6))}`));
		lines.push("");

		// Current Tool
		const currentTool = progress?.currentTool ?? this.state.currentTool;
		if (currentTool) {
			const toolLine = progress?.currentToolDuration
				? `Current Tool: ${currentTool} (${formatDuration(progress.currentToolDuration)})`
				: `Current Tool: ${currentTool}`;
			lines.push(this.theme.fg("warning", truncateToWidth(toolLine, width)));
		} else {
			lines.push(this.theme.fg("muted", "Current Tool: (none)"));
		}
		lines.push(this.theme.fg("borderMuted", divider));

		// Recent Output
		lines.push(this.theme.fg("text", `Recent Output (${toolCount} tools):`));
		if (progress?.recentOutput) {
			const outputLines = progress.recentOutput.split("\n").slice(-8);
			for (const line of outputLines) {
				lines.push(this.theme.fg("muted", `  > ${truncateToWidth(line, Math.max(1, width - 4))}`));
			}
		} else {
			lines.push(this.theme.fg("muted", "  (no output yet)"));
		}
		lines.push(this.theme.fg("borderMuted", divider));

		// Token Count
		const tokenStr = progress?.tokenCount?.toLocaleString() ?? "—";
		lines.push(this.theme.fg("text", `Token Count: ${tokenStr}`));

		// Activity Freshness
		if (progress?.activityFreshness) {
			lines.push(this.theme.fg("text", `Activity: ${formatFreshness(progress.activityFreshness)}`));
		}

		lines.push("");
		lines.push(this.theme.fg("borderMuted", "[Ctrl+O] collapse"));

		return lines;
	}
}

// ── Widget 控制 ──────────────────────────────────────────────────

let lastUpdateTime = 0;
let pendingUpdate: { ctx: ExtensionContext; state: WorkerWidgetState } | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 显示 worker 状态 widget（节流，避免 flicker）
 */
export function showWorkerStatus(ctx: ExtensionContext, state: WorkerWidgetState): void {
	if (!ctx.hasUI) return;

	// 更新全局状态（供展开态使用）
	latestWidgetState = state;
	latestCtx = ctx;

	// 如果展开态已激活，不覆盖折叠态 widget
	if (expandedActive) return;

	const now = Date.now();
	const elapsed = now - lastUpdateTime;

	if (elapsed >= UPDATE_THROTTLE_MS) {
		lastUpdateTime = now;
		renderWidget(ctx, state);
	} else {
		pendingUpdate = { ctx, state };
		if (!throttleTimer) {
			throttleTimer = setTimeout(() => {
				throttleTimer = null;
				if (pendingUpdate) {
					const { ctx: pendingCtx, state: pendingState } = pendingUpdate;
					pendingUpdate = null;
					lastUpdateTime = Date.now();
					renderWidget(pendingCtx, pendingState);
				}
			}, UPDATE_THROTTLE_MS - elapsed);
		}
	}
}

/**
 * 更新 AgentProgress 数据（供展开态消费）
 */
export function updateAgentProgress(progress: AgentProgress): void {
	latestProgress = {
		currentTool: progress.currentTool,
		recentOutput: progress.recentOutput,
		tokenCount: progress.tokenCount,
		duration: Date.now() - progress.startTime,
		activityFreshness: Date.now(),
		currentToolDuration: progress.currentTool ? Date.now() - progress.startTime : undefined,
	};

	// 如果展开态激活，触发重绘
	if (expandedActive && activeFullscreenComponent) {
		activeFullscreenComponent.invalidate();
	}
}

/**
 * 清除 worker 状态 widget
 */
export function clearWorkerStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	resetThrottleState();
	latestWidgetState = null;
	latestProgress = null;

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
	latestProgress = null;
	latestWidgetState = null;
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

/**
 * 渲染折叠态 widget（内部函数）
 */
function renderWidget(ctx: ExtensionContext, state: WorkerWidgetState): void {
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new WorkerStatusBox(theme, state));
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
	if (latestCtx && latestWidgetState) {
		renderWidget(latestCtx, latestWidgetState);
	}
}

/**
 * 切换折叠/展开状态（Ctrl+O 触发）
 *
 * - 折叠态 → 展开：移除折叠 widget，弹出全屏覆盖层
 * - 展开态 → 折叠：关闭全屏覆盖层，恢复折叠 widget
 */
export function toggleWorkerExpanded(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	if (expandedActive) {
		closeFullscreen();
		return;
	}

	// 需要有 worker 状态才能展开
	if (!latestWidgetState) return;

	latestCtx = ctx;
	expandedActive = true;

	// 移除折叠态 widget
	ctx.ui.setWidget(WIDGET_KEY, undefined);

	// 弹出全屏覆盖层
	void ctx.ui.custom(
		(tui, theme, _keybindings, _done) => {
			const component = new WorkerFullscreenView(
				theme,
				latestWidgetState!,
				latestProgress,
			);

			activeFullscreenComponent = component;

			// 定期刷新（进度数据变化时触发重绘）
			fullscreenRefreshTimer = setInterval(() => {
				if (!expandedActive) return;
				if (latestWidgetState && activeFullscreenComponent) {
					(activeFullscreenComponent as WorkerFullscreenView).updateData(
						latestWidgetState,
						latestProgress,
					);
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
