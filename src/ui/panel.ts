/**
 * ui/panel.ts — dteam 面板（0.6.0 最小版）
 *
 * 0.6.0 同步前台 Orchestrator Loop 下，面板降级为最小 worker 状态展示。
 * 0.5.0 的 mode/scheduling/batches/conflicts 渲染已随二维编排类型清除。
 * 后续 UI 重做时再扩展为 Orchestrator Loop 推进展示。
 */

import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { uiStore } from "./store.js";

export const WIDGET_KEY = "dteam-workers";
const PANEL_TABS = ["Workers", "Signals"] as const;

let panelExpanded = false;
let activeTab = 0;

export function isPanelExpanded(): boolean {
  return panelExpanded;
}

export function getActiveTab(): number {
  return activeTab;
}

function statusIcon(s: string): string {
  return (
    { pending: "◦", running: "⚒", done: "✓", failed: "✗", idle: "◦", in_progress: "⚒" }[s] ?? "?"
  );
}

/** 折叠态 widget：一行摘要 */
function renderCompact(state: ReturnType<typeof uiStore.getState>, width: number): string {
  const running = state.workers.filter((w) => w.status === "running").length;
  const done = state.workers.filter((w) => w.status === "done").length;
  const total = state.workers.length;
  const goal = truncateToWidth(state.goal || "dteam", Math.max(width - 24, 8), "…");
  return `⚙ dteam · ${goal} · ${done}/${total} done${running ? ` · ⚡${running}` : ""}`;
}

/** 展开态：Workers / Signals 两个 tab */
function renderExpanded(state: ReturnType<typeof uiStore.getState>, width: number, theme: any): string {
  const lines: string[] = [];
  const tabHeader = PANEL_TABS.map((t, i) => i === activeTab ? theme.fg("info", `[${i}:${t}]`) : theme.fg("dim", ` ${i}:${t} `)).join(" ");
  lines.push(tabHeader);

  if (activeTab === 0) {
    // Workers
    if (state.workers.length === 0) {
      lines.push(theme.fg("dim", "  （无 worker）"));
    } else {
      for (const w of state.workers) {
        const si = statusIcon(w.status);
        const title = truncateToWidth(w.title, width - 6, "…");
        lines.push(theme.fg("dim", `  ${si} ${title}`));
        if (w.recentOutput.length > 0) {
          const last = truncateToWidth(w.recentOutput[w.recentOutput.length - 1], width - 8, "…");
          lines.push(theme.fg("dim", `    ⎿ ${last}`));
        }
      }
    }
  } else {
    // Signals：聚合所有 worker 的信号
    const allSignals = state.workers.flatMap((w) => w.signals);
    if (allSignals.length === 0) {
      lines.push(theme.fg("dim", "  （无信号）"));
    } else {
      for (const s of allSignals.slice(-20)) {
        const line = truncateToWidth(`[${s.type}] ${s.summary}`, width - 4, "…");
        lines.push(theme.fg("dim", `  ${line}`));
      }
    }
  }

  return lines.join("\n");
}

export function renderWidget(ctx: any): void {
  if (!ctx.hasUI) return;
  const width = (process.stdout.columns || 80) - 2;
  const state = uiStore.getState();
  const theme = ctx.ui.theme ?? { fg: (_c: string, t: string) => t };

  if (panelExpanded) {
    ctx.ui.setWidget(WIDGET_KEY, { render: () => new Text(renderExpanded(state, width, theme), 0, 0) });
  } else {
    ctx.ui.setWidget(WIDGET_KEY, { render: () => new Text(renderCompact(state, width), 0, 0) });
  }
}

let lastFingerprint = "";
export function renderWidgetIfChanged(ctx: any, _intervalMs = 1000): void {
  const state = uiStore.getState();
  const fp = JSON.stringify(state);
  if (fp === lastFingerprint) return;
  lastFingerprint = fp;
  renderWidget(ctx);
}

export function clearWidget(ctx: any): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET_KEY, undefined);
  lastFingerprint = "";
}

export function handlePanelCommand(args: string | undefined, ctx: any): void {
  if (!ctx.hasUI) return;
  const arg = (args ?? "").trim();

  if (arg === "" ) {
    panelExpanded = !panelExpanded;
    renderWidget(ctx);
    return;
  }
  if (arg === "close") {
    panelExpanded = false;
    clearWidget(ctx);
    return;
  }
  // 数字：切 tab
  const n = Number(arg);
  if (Number.isInteger(n) && n >= 0 && n < PANEL_TABS.length) {
    activeTab = n;
    renderWidget(ctx);
    return;
  }
  ctx.ui.notify(`dteam: 未知面板命令 "${arg}"（支持：/dteam 展开、/dteam close、/dteam 0/1 切 tab）`, "warning");
}
