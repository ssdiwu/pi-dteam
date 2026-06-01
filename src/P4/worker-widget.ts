/**
 * Worker 状态 Widget — 在 TUI 中显示 worker 实时状态
 *
 * 借鉴 pi-tldr 的 bordered box 设计，用 ctx.ui.setWidget() 注册。
 * 显示信息：agent / task / tools / elapsed
 */

import type { ExtensionContext, Theme } from "@earendil-works/pi-coding-agent";
import type { Component } from "@earendil-works/pi-tui";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";

const WIDGET_KEY = "dteam-worker";
const MIN_BOX_WIDTH = 20;
const UPDATE_THROTTLE_MS = 1000;

// ── 类型定义 ──────────────────────────────────────────────────

export interface WorkerWidgetState {
	status: "pending" | "running" | "done" | "failed";
	agent?: string;
	task?: string;
	toolCount: number;
	currentTool?: string;
	elapsedMs: number;
}

// ── Component ──────────────────────────────────────────────────

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

// ── Widget 控制 ──────────────────────────────────────────────────

let lastUpdateTime = 0;
let pendingUpdate: { ctx: ExtensionContext; state: WorkerWidgetState } | null = null;
let throttleTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * 显示 worker 状态 widget（节流，避免 flicker）
 */
export function showWorkerStatus(ctx: ExtensionContext, state: WorkerWidgetState): void {
	if (!ctx.hasUI) return;

	const now = Date.now();
	const elapsed = now - lastUpdateTime;

	if (elapsed >= UPDATE_THROTTLE_MS) {
		// 立即更新
		lastUpdateTime = now;
		renderWidget(ctx, state);
	} else {
		// 节流：保存 pending，延迟更新
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
 * 清除 worker 状态 widget
 */
export function clearWorkerStatus(ctx: ExtensionContext): void {
	if (!ctx.hasUI) return;

	// 清除节流定时器
	if (throttleTimer) {
		clearTimeout(throttleTimer);
		throttleTimer = null;
	}
	pendingUpdate = null;
	lastUpdateTime = 0;

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
 * 渲染 widget（内部函数）
 */
function renderWidget(ctx: ExtensionContext, state: WorkerWidgetState): void {
	ctx.ui.setWidget(WIDGET_KEY, (_tui, theme) => new WorkerStatusBox(theme, state));
}
