/**
 * TUI 渲染层 — dteam 工具的 TUI 渲染 + 实时进度显示
 *
 * L1 renderCall   — 工具调用时展示（类型 + 任务摘要）
 * L2 renderResult  — 工具返回时展示（折叠/展开双模式）
 * L3 registerMessageRenderer — worker 实时进度消息（最多3行）
 * session_start   — 注册底部状态栏（worker 状态）
 */

import type { ExtensionAPI, AgentToolResult } from "@earendil-works/pi-coding-agent";
import { Text, Container, Spacer } from "@earendil-works/pi-tui";

/** Minimal Theme interface */
interface Theme {
	fg(color: string, text: string): string;
	bold(text: string): string;
	italic(text: string): string;
	underline(text: string): string;
}

// ── Types ──────────────────────────────────────────────────────

interface WorkerProgress {
	workerId: string;
	status: "pending" | "running" | "done" | "failed";
	task: string;
	style?: string;
	updatedAt: number;
}

// ── 全局状态 ──────────────────────────────────────────────────

const workerProgress = new Map<string, WorkerProgress>();
const MAX_DISPLAY_LINES = 3;

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

		// 更新全局状态
		workerProgress.set(workerId, {
			workerId,
			status: status as any,
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

	// ── session_start: 注册 setStatus 底部状态栏 ──

	let unsubRender: (() => void) | null = null;

	pi.on("session_start", async (_event, ctx) => {
		// 移除旧监听器（session 重启 / /reload 时 ctx 已失效）
		if (unsubRender) {
			unsubRender();
			unsubRender = null;
		}

		const refreshStatus = () => {
			if (!ctx.hasUI) return;

			// 获取所有 worker 状态
			const workers = Array.from(workerProgress.values());

			if (workers.length === 0) {
				ctx.ui.setStatus("dteam", undefined);
				return;
			}

			// 按更新时间排序，取最新的几个
			const sorted = workers
				.sort((a, b) => b.updatedAt - a.updatedAt)
				.slice(0, MAX_DISPLAY_LINES);

			// 构建状态文本
			const statusLines = sorted.map((w) => {
				const { icon } = formatStatus(w.status);
				return `${icon} ${trim(w.task, 20)}`;
			});

			ctx.ui.setStatus("dteam", statusLines.join(" │ "));
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
	// 更新全局状态
	workerProgress.set(workerId, {
		workerId,
		status,
		task,
		updatedAt: Date.now(),
	});

	// 只触发状态栏刷新，不发消息到聊天流
	pi.events.emit("dteam:render-status", undefined);
}
