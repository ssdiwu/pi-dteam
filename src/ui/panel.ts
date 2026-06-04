/**
 * ui/panel.ts — dteam 面板（widget 模式）
 *
 * 通过 ctx.ui.setWidget() 显示在右侧边栏。
 * 支持两种态：
 *   - 展开态：/dteam 触发，显示完整面板（含 tab 内容）
 *   - 折叠态：run 进行中自动显示，紧凑摘要
 *
 * Tab 切换通过 /dteam <tabIdx> 命令参数实现。
 * 所有行经过 truncateToWidth 兜底。
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { uiStore, type UIWorkerState } from "./store.js";
import { statusIcon, formatDuration } from "./helpers.js";

// ---------------------------------------------------------------------------
// 状态
// ---------------------------------------------------------------------------

let panelExpanded = false;
let activeTabIdx = 0;

export function isPanelExpanded(): boolean {
  return panelExpanded;
}

export function getActiveTab(): number {
  return activeTabIdx;
}

// ---------------------------------------------------------------------------
// Tab 定义
// ---------------------------------------------------------------------------

interface TabDef {
  key: string;
  label: string;
}

function buildTabs(workers: UIWorkerState[]): TabDef[] {
  const tabs: TabDef[] = [{ key: "__overview__", label: "总览" }];
  for (const w of workers) {
    tabs.push({ key: w.id, label: `W:${truncateToWidth(w.title, 14, "")}` });
  }
  return tabs;
}

// ---------------------------------------------------------------------------
// 各 tab 内容渲染
// ---------------------------------------------------------------------------

function renderOverview(
  state: ReturnType<typeof uiStore.getState>,
  width: number,
): string[] {
  const workers = state.workers;
  const elapsed = Date.now() - (state.startedAt || Date.now());
  const done = workers.filter((w) => w.status === "done").length;
  const failed = workers.filter((w) => w.status === "failed").length;
  const summary =
    failed > 0 ? `${done}/${workers.length} 完成, ${failed} 失败` : `${done}/${workers.length} 完成`;

  const lines: string[] = [
    "",
    truncateToWidth(`  目标: ${state.goal}`, width, "…"),
    truncateToWidth(`  耗时: ${formatDuration(elapsed)}  ${summary}`, width, "…"),
    "",
  ];

  for (const w of workers) {
    const icon = statusIcon(w.status);
    const dur =
      w.startedAt && w.finishedAt
        ? formatDuration(w.finishedAt - w.startedAt)
        : w.startedAt
          ? formatDuration(Date.now() - w.startedAt)
          : "";
    const tool = w.status === "running" && w.currentTool ? ` · ${w.currentTool}` : "";
    lines.push(truncateToWidth(`  ${icon} ${w.title}${tool}  ${dur}`, width, "…"));

    if (w.recentOutput?.length) {
      for (const ol of w.recentOutput.slice(-2)) {
        lines.push(truncateToWidth(`    ⎿ ${ol}`, width, "…"));
      }
    }
  }

  return lines;
}

function renderWorkerTab(worker: UIWorkerState, width: number): string[] {
  const elapsed = worker.startedAt
    ? worker.finishedAt
      ? formatDuration(worker.finishedAt - worker.startedAt)
      : formatDuration(Date.now() - worker.startedAt)
    : "未开始";

  const lines: string[] = [
    truncateToWidth(`  ${statusIcon(worker.status)} ${worker.title}`, width, "…"),
    truncateToWidth(`  状态: ${worker.status} · 耗时: ${elapsed}`, width, "…"),
    "",
  ];

  if (worker.currentTool) {
    lines.push(truncateToWidth(`  当前工具: ${worker.currentTool}`, width, "…"));
    lines.push("");
  }

  if (worker.recentOutput?.length) {
    lines.push("  ── 输出 ──");
    for (const ol of worker.recentOutput.slice(-20)) {
      lines.push(truncateToWidth(`  ${ol}`, width, "…"));
    }
  } else {
    lines.push("  （暂无输出）");
  }

  return lines;
}

// ---------------------------------------------------------------------------
// Tab 栏渲染
// ---------------------------------------------------------------------------

function buildTabBarLine(
  theme: any,
  tabs: TabDef[],
  currentIdx: number,
  width: number,
): string {
  const parts = tabs.map((tab, i) => {
    if (i === currentIdx) return theme.fg("accent", `[${i}:${tab.label}]`);
    return theme.fg("muted", ` ${i}:${tab.label} `);
  });
  return truncateToWidth(parts.join(" "), width, "…");
}

// ---------------------------------------------------------------------------
// 统一组件构建（供 setWidget 使用）
// ---------------------------------------------------------------------------

function buildComponent(): (_tui: unknown, theme: any) => {
  render(w: number): string[];
  invalidate(): void;
} {
  return (_tui: unknown, theme: any) => {
    /** 安全截断 */
    const safe = (lines: string[], w: number): string[] =>
      lines.map((l) => truncateToWidth(l, w, "…"));

    return {
      render(width: number) {
        const state = uiStore.getState();
        const innerW = Math.max(20, width - 4);

        // ── 展开态 ──
        if (panelExpanded) {
          if (!state.goal) {
            return safe(
              [
                "",
                theme.fg("accent", " 📊 dteam worker 进度"),
                theme.fg("borderMuted", "─".repeat(innerW)),
                theme.fg("muted", "  （无 worker 正在工作）"),
                "",
                theme.fg("dim", '  启动 worker：让主 LLM 调 dteam(action="run", goal="...")'),
                theme.fg("borderMuted", "─".repeat(innerW)),
                theme.fg("dim", "  再输 /dteam 关闭面板"),
                "",
              ],
              width,
            );
          }

          const tabs = buildTabs(state.workers);
          if (activeTabIdx >= tabs.length) activeTabIdx = Math.max(0, tabs.length - 1);

          const workers = state.workers;
          const elapsed = Date.now() - (state.startedAt || Date.now());
          const doneCount = workers.filter((w) => w.status === "done").length;
          const failedCount = workers.filter((w) => w.status === "failed").length;
          const summary =
            failedCount > 0
              ? `${doneCount}/${workers.length} 完成, ${failedCount} 失败`
              : `${doneCount}/${workers.length} 完成`;
          const goalText = truncateToWidth(state.goal || "dteam", innerW - 30, "…");

          const lines: string[] = [
            "",
            theme.fg(
              "accent",
              ` ⚙ dteam · ${goalText} · ${formatDuration(elapsed)} · ${summary}`,
            ),
            buildTabBarLine(theme, tabs, activeTabIdx, width),
            theme.fg("borderMuted", "─".repeat(innerW)),
          ];

          // 当前 tab 内容
          const currentTab = tabs[activeTabIdx];
          if (!currentTab) {
            lines.push(theme.fg("muted", "  （无内容）"));
          } else if (currentTab.key === "__overview__") {
            lines.push(...renderOverview(state, width));
          } else {
            const worker = workers.find((w) => w.id === currentTab.key);
            if (worker) {
              lines.push(...renderWorkerTab(worker, width));
            } else {
              lines.push(theme.fg("muted", "  （worker 已结束）"));
            }
          }

          lines.push(theme.fg("borderMuted", "─".repeat(innerW)));
          lines.push(theme.fg("dim", "  /dteam N 切换 tab · /dteam 关闭"));
          lines.push("");

          return safe(lines, width);
        }

        // ── 折叠态（run 进行中自动显示）──
        if (!state.goal) {
          return safe([], width);
        }

        const workers = state.workers ?? [];
        const elapsed = Date.now() - (state.startedAt || Date.now());
        const done = workers.filter((w) => w.status === "done").length;
        const failed = workers.filter((w) => w.status === "failed").length;
        const goalText = truncateToWidth(state.goal, 25, "…");
        const summary =
          failed > 0
            ? `${done}/${workers.length} 完成, ${failed} 失败`
            : `${done}/${workers.length} 完成`;

        const lines: string[] = [
          truncateToWidth(
            theme.fg("dim", `⚙ dteam · ${goalText} · ${formatDuration(elapsed)} · ${summary}`),
            width,
            "…",
          ),
        ];

        for (let i = 0; i < workers.length; i++) {
          const w = workers[i];
          const isLast = i === workers.length - 1;
          const branch = isLast ? "└" : "├";
          const icon = statusIcon(w.status);
          const title = truncateToWidth(w.title ?? "", 30, "…");
          lines.push(
            truncateToWidth(theme.fg("dim", `${branch} ${icon} ${title}`), width, "…"),
          );
        }

        return safe(lines, width);
      },

      invalidate() {},
    };
  };
}

// ---------------------------------------------------------------------------
// 公开 API
// ---------------------------------------------------------------------------

export const WIDGET_KEY = "dteam-workers";

/** 设置/刷新 widget */
export function renderWidget(ctx: any): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET_KEY, buildComponent());
}

/** 清除 widget */
export function clearWidget(ctx: any): void {
  panelExpanded = false;
  if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
}

/**
 * 面板命令处理：
 *   /dteam       → 展开/关闭（toggle）
 *   /dteam 1     → 展开并切换到 tab 1
 *   /dteam close → 关闭
 */
export function handlePanelCommand(args: string | undefined, ctx: any): void {
  if (!ctx.hasUI) return;

  // 关闭指令
  if (args === "close") {
    panelExpanded = false;
    const state = uiStore.getState();
    if (state.goal) {
      renderWidget(ctx);
    } else {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
    return;
  }

  // 数字 → 切换到指定 tab
  const tabNum = parseInt(args ?? "", 10);
  if (!isNaN(tabNum)) {
    panelExpanded = true;
    activeTabIdx = Math.max(0, tabNum);
    renderWidget(ctx);
    return;
  }

  // 无参数 → toggle
  if (panelExpanded) {
    panelExpanded = false;
    const state = uiStore.getState();
    if (state.goal) {
      renderWidget(ctx);
    } else {
      ctx.ui.setWidget(WIDGET_KEY, undefined);
    }
  } else {
    panelExpanded = true;
    activeTabIdx = 0;
    renderWidget(ctx);
  }
}
