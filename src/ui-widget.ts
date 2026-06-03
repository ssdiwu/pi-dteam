/**
 * ui-widget.ts — dteam v1 折叠态 TUI widget
 *
 * 在 Pi 右侧 widget 区域显示 dteam 运行状态。
 * 有任务时显示进度树，无任务时显示"就绪"提示。
 */

import { uiStore } from "./ui-store.js"
import { statusIcon, formatDuration, truncText } from "./ui-render.js"
import type { Component } from "@earendil-works/pi-tui"
import { Container, Text } from "@earendil-works/pi-tui"

export const WIDGET_KEY = "dteam-workers"

/**
 * 构建 widget 组件。每次 Pi 刷新 widget 时调用。
 */
export function buildWidgetComponent(): (_tui: unknown, theme: any) => Component {
	return (_tui: unknown, theme: any): Component => {
		const state = uiStore.getState()
		const container = new Container()

		// 没有在运行 → 显示"就绪"提示
		if (!state.goal) {
			container.addChild(new Text(theme.fg("dim", "⚙ dteam · 就绪"), 0, 0))
			return container
		}

		// ── 有任务在跑 ──

		const workers = state.workers ?? []
		const elapsed = Date.now() - (state.startedAt || Date.now())
		const duration = formatDuration(elapsed)
		const done = workers.filter(w => w.status === "done").length
		const failed = workers.filter(w => w.status === "failed").length

		// 第一行：⚙ dteam · goal · 时间 · 摘要
		const goalText = truncText(state.goal, 25)
		const summary = failed > 0 ? `${done}/${workers.length} 完成, ${failed} 失败` : `${done}/${workers.length} 完成`
		container.addChild(new Text(
			theme.fg("dim", `⚙ dteam · ${goalText} · ${duration} · ${summary}`),
			0, 0,
		))

		// 后续行：每个 worker
		for (let i = 0; i < workers.length; i++) {
			const w = workers[i]
			const isLast = i === workers.length - 1
			const branch = isLast ? "└" : "├"
			const icon = statusIcon(w.status)
			const title = truncText(w.title ?? "", 35)

			// 状态细节
			let detail = ""
			if (w.status === "running" && w.currentTool) {
				detail = `· ${w.currentTool}`
			} else if (w.status === "done") {
				detail = "✓"
			} else if (w.status === "failed") {
				detail = "✗"
			}

			container.addChild(new Text(
				theme.fg("dim", `${branch} ${icon} ${title} ${detail}`),
				0, 0,
			))

			// 最新输出（只取最后 1 行）
			if (w.recentOutput?.length) {
				const lastLine = truncText(w.recentOutput[w.recentOutput.length - 1] ?? "", 50)
				container.addChild(new Text(
					theme.fg("dim", `  ⎿ ${lastLine}`),
					0, 0,
				))
			}
		}

		return container
	}
}

/**
 * 注册/刷新 dteam widget。安全用于无 UI 模式。
 */
export function renderWidget(ctx: any): void {
	if (!ctx.hasUI) return
	ctx.ui.setWidget(WIDGET_KEY, buildWidgetComponent())
}
