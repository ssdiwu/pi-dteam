/**
 * ui-panel.ts — dteam v1 统一面板
 *
 * 一个 key，两种态：
 *   - 折叠态：run 进行中自动显示在右侧（worker 摘要）
 *   - 展开态：/dteam 触发（完整面板，空态也有内容）
 *
 * /dteam toggle：展开 ↔ 关闭
 * run 进行中：自动折叠态刷新
 * run 结束 3s：折叠态消失
 */

import { uiStore } from "./ui-store.js"
import { statusIcon, formatDuration, truncText } from "./ui-render.js"

export const WIDGET_KEY = "dteam-workers"

// ═══ 面板状态 ═══

let panelExpanded = false

export function isPanelExpanded(): boolean {
  return panelExpanded
}

// ═══ 统一渲染入口 ═══

function buildComponent(): (_tui: unknown, theme: any) => { render(w: number): string[]; invalidate(): void } {
  return (_tui: unknown, theme: any) => {
    return {
      render(width: number) {
        const state = uiStore.getState()
        const innerW = Math.max(20, width - 4)
        const sep = "─".repeat(innerW)

        // ── 展开态（/dteam 触发）──
        if (panelExpanded) {
          if (!state.goal) {
            // 空态面板
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
          }

          // 进度面板
          const workers = state.workers ?? []
          const elapsed = Date.now() - (state.startedAt || Date.now())
          const done = workers.filter(w => w.status === "done").length
          const failed = workers.filter(w => w.status === "failed").length
          const summary = failed > 0
            ? `${done}/${workers.length} 完成, ${failed} 失败`
            : `${done}/${workers.length} 完成`
          const goalText = truncText(state.goal, innerW - 30)

          const lines: string[] = [
            "",
            theme.fg("accent", ` 📊 dteam · ${goalText} · ${formatDuration(elapsed)} · ${summary}`),
            theme.fg("borderMuted", sep),
          ]

          for (const w of workers) {
            const icon = statusIcon(w.status)
            const title = truncText(w.title ?? "", innerW - 12)
            const detail = w.status === "running" && w.currentTool ? ` · ${w.currentTool}` : ""
            lines.push(theme.fg("text", `  ${icon} ${title}${detail}`))
            if (w.recentOutput?.length) {
              for (const line of w.recentOutput.slice(-2)) {
                lines.push(theme.fg("muted", `    ⎿ ${truncText(line, innerW - 8)}`))
              }
            }
          }

          lines.push(theme.fg("borderMuted", sep))
          lines.push(theme.fg("dim", "  再输 /dteam 关闭面板"))
          lines.push("")
          return lines
        }

        // ── 折叠态（run 进行中自动显示）──
        if (!state.goal) {
          // 没 run 也不展开 → 不显示
          return []
        }

        const workers = state.workers ?? []
        const elapsed = Date.now() - (state.startedAt || Date.now())
        const done = workers.filter(w => w.status === "done").length
        const failed = workers.filter(w => w.status === "failed").length
        const goalText = truncText(state.goal, 25)
        const summary = failed > 0 ? `${done}/${workers.length} 完成, ${failed} 失败` : `${done}/${workers.length} 完成`

        const lines: string[] = [
          theme.fg("dim", `⚙ dteam · ${goalText} · ${formatDuration(elapsed)} · ${summary}`),
        ]

        for (let i = 0; i < workers.length; i++) {
          const w = workers[i]
          const isLast = i === workers.length - 1
          const branch = isLast ? "└" : "├"
          const icon = statusIcon(w.status)
          const title = truncText(w.title ?? "", 30)
          lines.push(theme.fg("dim", `${branch} ${icon} ${title}`))
        }

        return lines
      },
      invalidate() {},
    }
  }
}

// ═══ 公开 API ═══

/** 设置/刷新 widget（安全用于无 UI 模式） */
export function renderWidget(ctx: any): void {
  if (!ctx.hasUI) return
  ctx.ui.setWidget(WIDGET_KEY, buildComponent())
}

/** 清除 widget */
export function clearWidget(ctx: any): void {
  panelExpanded = false
  if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined)
}

/** toggle 面板（/dteam 命令入口） */
export function togglePanel(ctx: any): void {
  if (!ctx.hasUI) return

  if (panelExpanded) {
    // 关闭
    panelExpanded = false
    // 如果有活跃 run，降级为折叠态；否则完全清除
    const state = uiStore.getState()
    if (state.goal) {
      renderWidget(ctx)
    } else {
      ctx.ui.setWidget(WIDGET_KEY, undefined)
    }
  } else {
    // 打开
    panelExpanded = true
    renderWidget(ctx)
  }
}
