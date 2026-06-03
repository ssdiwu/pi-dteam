/**
 * ui-panel.ts — dteam v1 展开/空态面板
 *
 * /dteam 命令触发的完整 TUI 面板。
 * 有 run 时显示 worker 进度详情，无 run 时显示"就绪"面板。
 * 再输 /dteam 关闭面板（toggle 行为）。
 */

import { uiStore } from "./ui-store.js"
import { statusIcon, formatDuration, truncText } from "./ui-render.js"

export const PANEL_KEY = "dteam-workers"

// ═══ 面板状态 ═══

let panelActive = false

export function isPanelActive(): boolean {
  return panelActive
}

/** 渲染空态面板（无活跃 run） */
function buildEmptyPanel(theme: any, width: number): { render(width: number): string[]; invalidate(): void } {
  return {
    render(_w: number) {
      const sep = "─".repeat(Math.max(20, width - 4))
      return [
        "",
        theme.fg("accent", " 📊 dteam worker 进度"),
        theme.fg("borderMuted", sep),
        theme.fg("muted", "  （无 worker 正在工作）"),
        "",
        theme.fg("dim", "  启动 worker：让主 LLM 调 dteam(action=\"run\", goal=\"...\")"),
        theme.fg("borderMuted", sep),
        theme.fg("dim", "  再输 /dteam 关闭面板"),
        "",
      ]
    },
    invalidate() {},
  }
}

/** 渲染进度面板（有活跃 run） */
function buildProgressPanel(theme: any, width: number): { render(width: number): string[]; invalidate(): void } {
  return {
    render(_w: number) {
      const state = uiStore.getState()
      const sep = "─".repeat(Math.max(20, width - 4))
      const lines: string[] = []
      const innerW = Math.max(40, width - 4)

      lines.push("")

      // 标题行
      const elapsed = Date.now() - (state.startedAt || Date.now())
      const workers = state.workers ?? []
      const done = workers.filter(w => w.status === "done").length
      const failed = workers.filter(w => w.status === "failed").length
      const summary = failed > 0
        ? `${done}/${workers.length} 完成, ${failed} 失败`
        : `${done}/${workers.length} 完成`
      const goalText = truncText(state.goal ?? "", innerW - 30)

      lines.push(theme.fg("accent", ` 📊 dteam · ${goalText} · ${formatDuration(elapsed)} · ${summary}`))
      lines.push(theme.fg("borderMuted", sep))

      // 每个 worker 详情
      for (const w of workers) {
        const icon = statusIcon(w.status)
        const title = truncText(w.title ?? "", innerW - 10)

        // 状态行
        let detail = ""
        if (w.status === "running" && w.currentTool) {
          detail = ` · ${w.currentTool}`
        }
        lines.push(theme.fg("text", `  ${icon} ${title}${detail}`))

        // 最新输出（最多 3 行）
        if (w.recentOutput?.length) {
          const recentLines = w.recentOutput.slice(-3)
          for (const line of recentLines) {
            lines.push(theme.fg("muted", `    ⎿ ${truncText(line, innerW - 8)}`))
          }
        }

        // 结果（done 状态时取最近输出的最后一条）
        if (w.status === "done" && w.recentOutput?.length) {
          const lastLine = w.recentOutput[w.recentOutput.length - 1] ?? ""
          lines.push(theme.fg("dim", `    ⎿ ${truncText(lastLine, innerW - 8)}`))
        }
      }

      // 底部
      lines.push(theme.fg("borderMuted", sep))
      lines.push(theme.fg("dim", "  再输 /dteam 关闭面板"))
      lines.push("")

      return lines
    },
    invalidate() {},
  }
}

/**
 * 切换面板（/dteam 命令入口）
 * 已展开 → 关闭；未展开 → 打开。
 */
export function togglePanel(ctx: any): void {
  if (!ctx.hasUI) return

  if (panelActive) {
    // 关闭
    panelActive = false
    ctx.ui.setWidget(PANEL_KEY, undefined)
    return
  }

  // 打开
  panelActive = true
  renderPanel(ctx)
}

/**
 * 关闭面板（供外部调用，如 run 完成后）
 */
export function closePanel(ctx: any): void {
  if (!panelActive) return
  panelActive = false
  if (ctx.hasUI) ctx.ui.setWidget(PANEL_KEY, undefined)
}

/**
 * 渲染面板内容（刷新用）
 */
export function renderPanel(ctx: any): void {
  if (!panelActive || !ctx.hasUI) return

  ctx.ui.setWidget(PANEL_KEY, (_tui: unknown, theme: any) => {
    const state = uiStore.getState()
    const width = (process.stdout.columns || 80)

    if (state.goal) {
      return buildProgressPanel(theme, width)
    }
    return buildEmptyPanel(theme, width)
  })
}
