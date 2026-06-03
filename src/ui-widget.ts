/**
 * ui-widget.ts — dteam v1 collapsed TUI widget
 *
 * Renders a compact summary of the current dteam run in Pi's
 * right-hand widget area. Shows the goal and one line per worker.
 */

import { uiStore } from "./ui-store.js"
import { statusIcon, formatDuration, truncText, formatSummary } from "./ui-render.js"
import type { Component } from "@earendil-works/pi-tui"
import { Container, Text } from "@earendil-works/pi-tui"

export const WIDGET_KEY = "dteam-workers"

/**
 * Build a widget component that renders the current dteam state.
 * Called each time Pi requests a fresh widget render.
 */
export function buildWidgetComponent(): (_tui: unknown, theme: any) => Component {
	return (_tui: unknown, theme: any): Component => {
		const state = uiStore.getState()

		// Not running — return an empty container
		if (!state.goal) {
			return new Container()
		}

		const lines: string[] = []

		// Header line: ⚙ dteam · {goal up to 30 chars} · {duration}
		const goalText = truncText(state.goal, 30)
		const elapsed = Date.now() - (state.startedAt || Date.now())
		const duration = formatDuration(elapsed)
		lines.push(`⚙ dteam · ${goalText} · ${duration}`)

		// Worker lines
		const workers = state.workers ?? []
		const lastIndex = workers.length - 1

		for (let i = 0; i < workers.length; i++) {
			const w = workers[i]
			const branch = i === lastIndex ? "└" : "├"
			const icon = statusIcon(w.status)
			const title = truncText(w.title ?? "", 40)

			// Build status detail from worker state
			const done = state.workers.filter(
				(wk) => wk.status === "done" || wk.status === "decomposed"
			).length
			const failed = state.workers.filter((wk) => wk.status === "failed").length
			const detail =
				workers.length > 0
					? formatSummary(done, workers.length, failed)
					: w.status
			lines.push(`${branch} ${icon} ${title} · ${detail}`)

			if (w.recentOutput && w.recentOutput.length > 0) {
				const lastOutput = w.recentOutput[w.recentOutput.length - 1]
				const output = truncText(lastOutput, 60)
				lines.push(`  ⎿ ${output}`)
			}
		}

		// Build themed container
		const container = new Container()
		for (const line of lines) {
			const text = new Text(theme.fg("dim", line))
			container.addChild(text)
		}

		return container
	}
}

/**
 * Register (or refresh) the dteam widget on Pi's sidebar.
 * Safe to call even when Pi is running in headless mode.
 */
export function renderWidget(ctx: any): void {
	if (!ctx.hasUI) return
	ctx.ui.setWidget(WIDGET_KEY, buildWidgetComponent())
}
