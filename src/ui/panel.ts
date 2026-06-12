/*
 * ui/panel.ts — dteam widget / expanded panel
 *
 * 折叠态：低噪声任务树。
 * 展开态：固定内容 tabs（概览 / 批次 / Workers / 信号 / 报告）。
 */

import { truncateToWidth } from "@earendil-works/pi-tui";
import { uiStore, type UIState, type UIWorkerState, type UISignal } from "./store.js";
import { statusIcon, statusColor, formatDuration, signalIcon, signalLabel, strike } from "./helpers.js";

let panelExpanded = false;
let activeTabIdx = 0;
let lastFingerprint = "";
let lastTimeRender = 0;

export const WIDGET_KEY = "dteam-workers";

interface TabDef {
  key: "overview" | "batches" | "workers" | "signals" | "report";
  label: string;
}

const CONTENT_TABS: TabDef[] = [
  { key: "overview", label: "概览" },
  { key: "batches", label: "批次" },
  { key: "workers", label: "Workers" },
  { key: "signals", label: "信号" },
  { key: "report", label: "报告" },
];

export function isPanelExpanded(): boolean {
  return panelExpanded;
}

export function getActiveTab(): number {
  return activeTabIdx;
}

function realWorkers(state: UIState): UIWorkerState[] {
  return state.workers.filter((worker) => worker.id !== "plan");
}

function elapsedForRun(state: UIState): number {
  return (state.finishedAt ?? Date.now()) - (state.startedAt || Date.now());
}

function runSummary(state: UIState): string {
  const workers = realWorkers(state);
  const done = workers.filter((worker) => worker.status === "done").length;
  const failed = workers.filter((worker) => worker.status === "failed" || worker.status === "error").length;
  if (workers.length === 0) return "准备中";
  return failed > 0 ? `${done}/${workers.length} 完成, ${failed} 失败` : `${done}/${workers.length} 完成`;
}

function currentBatchLine(state: UIState): string {
  const scheduling = state.scheduling;
  if (!scheduling) return "当前批次: 未生成";
  const runningIndexes = new Set(
    realWorkers(state)
      .filter((worker) => worker.status === "running")
      .map(stepIndexFromWorker)
      .filter((index): index is number => index !== null),
  );
  const current = scheduling.batches.find((batch) => batch.stepIndexes.some((index) => runningIndexes.has(index)));
  if (current) return `当前批次: #${current.index} [${current.stepIndexes.join(", ")}]`;
  const doneIndexes = new Set(
    realWorkers(state)
      .filter((worker) => worker.status === "done")
      .map(stepIndexFromWorker)
      .filter((index): index is number => index !== null),
  );
  const next = scheduling.batches.find((batch) => batch.stepIndexes.some((index) => !doneIndexes.has(index)));
  return next ? `下一批次: #${next.index} [${next.stepIndexes.join(", ")}]` : "当前批次: 全部完成";
}

function renderOverview(state: UIState, width: number, theme: any): string[] {
  const lines = [
    "",
    truncateToWidth(`  目标: ${state.goal}`, width, "…"),
    truncateToWidth(`  mode: ${state.mode ?? "unknown"} · ${runSummary(state)} · ${formatDuration(elapsedForRun(state))}`, width, "…"),
    truncateToWidth(`  reason: ${state.planReason ?? "未记录"}`, width, "…"),
    truncateToWidth(`  ${currentBatchLine(state)}`, width, "…"),
  ];
  const conflicts = state.scheduling?.conflicts ?? [];
  const warnings = conflicts.filter((conflict) => conflict.type === "unknown" || conflict.type === "shared" || conflict.type === "hard");
  if (warnings.length > 0) lines.push(theme.fg("warning", `  warning: ${warnings.length} 个调度提示`));
  return lines;
}

function renderBatches(state: UIState, width: number, theme: any): string[] {
  const scheduling = state.scheduling;
  if (!scheduling) return ["", theme.fg("muted", "  （暂无调度计划）")];
  const lines = ["", theme.fg("accent", "  批次")];
  for (const batch of scheduling.batches) {
    lines.push(truncateToWidth(`  #${batch.index} steps [${batch.stepIndexes.join(", ")}] · ${batch.reason}`, width, "…"));
  }
  if (scheduling.delayedSteps.length > 0) {
    lines.push("", theme.fg("warning", "  延后"));
    for (const delay of scheduling.delayedSteps) {
      lines.push(truncateToWidth(`  ↳ step-${delay.stepIndex}: ${delay.delayedBecause.join("；")}`, width, "…"));
    }
  }
  if (scheduling.conflicts.length > 0) {
    lines.push("", theme.fg("warning", "  冲突 / 提示"));
    for (const conflict of scheduling.conflicts.slice(0, 8)) {
      const files = conflict.files?.length ? ` · ${conflict.files.join(", ")}` : "";
      lines.push(truncateToWidth(`  ${conflict.type}: steps [${conflict.stepIndexes.join(", ")}]${files} · ${conflict.reason}`, width, "…"));
    }
  }
  return lines;
}

function renderWorkers(state: UIState, width: number, theme: any): string[] {
  const workers = realWorkers(state);
  if (workers.length === 0) return ["", theme.fg("muted", "  （暂无 worker）")];
  const lines = [""];
  workers.forEach((worker, index) => {
    const branch = index === workers.length - 1 ? "└" : "├";
    lines.push(renderCompactWorkerLine(worker, branch, width, theme));
    if (worker.files?.length) lines.push(truncateToWidth(theme.fg("dim", `│   files: ${worker.files.join(", ")}`), width, "…"));
    for (const output of worker.recentOutput.slice(-2)) {
      const firstLine = output.split("\n")[0]?.trim();
      if (firstLine) lines.push(truncateToWidth(theme.fg("muted", `│   ⎿ ${firstLine}`), width, "…"));
    }
  });
  return lines;
}

function renderSignals(state: UIState, width: number, theme: any): string[] {
  const signals = realWorkers(state).flatMap((worker) => worker.signals);
  if (signals.length === 0) return ["", theme.fg("muted", "  （暂无信号）")];
  const lines = [""];
  for (const [type, items] of groupedSignals(signals)) {
    lines.push(theme.fg("accent", `  ${signalIcon(type)} ${signalLabel(type)}: ${items.length} 条`));
    for (const signal of items.slice(-5)) {
      lines.push(truncateToWidth(theme.fg("dim", `    ⎿ ${signal.workerId}: ${signal.summary}`), width, "…"));
    }
  }
  return lines;
}

function renderReport(state: UIState, width: number, theme: any): string[] {
  const lines = [""];
  if (!state.finishedAt) {
    lines.push(theme.fg("muted", "  报告待完成"));
    lines.push(truncateToWidth(`  当前: ${runSummary(state)}`, width, "…"));
    return lines;
  }
  lines.push(theme.fg("accent", `  final: ${runSummary(state)}`));
  lines.push(truncateToWidth(`  mode: ${state.mode ?? "unknown"}`, width, "…"));
  if (state.scheduling) {
    lines.push(truncateToWidth(`  batches: ${state.scheduling.batches.map((b) => `[${b.stepIndexes.join(",")}]`).join(" → ")}`, width, "…"));
    lines.push(truncateToWidth(`  conflicts: ${state.scheduling.conflicts.length}`, width, "…"));
  }
  return lines;
}

function groupedSignals(signals: UISignal[]): Array<[string, UISignal[]]> {
  const byType = new Map<string, UISignal[]>();
  for (const signal of signals) byType.set(signal.type, [...(byType.get(signal.type) ?? []), signal]);
  return [...byType.entries()].sort(([a], [b]) => a.localeCompare(b));
}

function buildTabBarLine(theme: any, currentIdx: number, width: number): string {
  const parts = CONTENT_TABS.map((tab, index) => {
    const label = `${index}:${tab.label}`;
    return index === currentIdx ? theme.fg("accent", `[${label}]`) : theme.fg("muted", ` ${label} `);
  });
  return truncateToWidth(parts.join(" "), width, "…");
}

function renderCompactWorkerLine(worker: UIWorkerState, branch: string, width: number, theme: any): string {
  const icon = statusIcon(worker.status);
  const color = statusColor(worker.status);
  const titleMaxW = Math.max(20, width - 8);
  const rawTitle = truncateToWidth(worker.title ?? "", titleMaxW, "…");
  const title = worker.status === "done" ? strike(rawTitle) : rawTitle;
  return truncateToWidth(theme.fg(color, `${branch} ${icon} ${title}`), width, "…");
}

function latestOutputLine(worker: UIWorkerState): string {
  const last = worker.recentOutput[worker.recentOutput.length - 1] ?? "";
  return last.split("\n")[0]?.trim() ?? "";
}

function prioritizeWorkers(workers: UIWorkerState[]): UIWorkerState[] {
  const score: Record<string, number> = { failed: 0, error: 0, running: 1, delayed: 2, idle: 3, pending: 3, done: 4 };
  return [...workers].sort((a, b) => (score[a.status] ?? 3) - (score[b.status] ?? 3) || (a.startedAt ?? 0) - (b.startedAt ?? 0));
}

function delayedStepIndexes(scheduling: UIState["scheduling"]): Map<number, string> {
  const delayed = new Map<number, string>();
  for (const item of scheduling?.delayedSteps ?? []) delayed.set(item.stepIndex, item.delayedBecause.join("；"));
  return delayed;
}

function stepIndexFromWorker(worker: UIWorkerState): number | null {
  const match = worker.id.match(/^step-(\d+)$/);
  return match ? Number(match[1]) : null;
}

function renderExpanded(state: UIState, width: number, innerW: number, theme: any): string[] {
  if (!state.goal) return renderEmptyExpanded(innerW, theme);
  if (activeTabIdx >= CONTENT_TABS.length) activeTabIdx = CONTENT_TABS.length - 1;
  const goalText = truncateToWidth(state.goal || "dteam", innerW - 32, "…");
  const lines = [
    "",
    theme.fg("accent", ` ⚙ dteam · ${goalText} · ${formatDuration(elapsedForRun(state))} · ${runSummary(state)}`),
    buildTabBarLine(theme, activeTabIdx, width),
    theme.fg("borderMuted", "─".repeat(innerW)),
    ...renderActiveTab(state, width, theme),
    theme.fg("borderMuted", "─".repeat(innerW)),
    theme.fg("dim", "  /dteam N 切换 tab · /dteam close 关闭"),
    "",
  ];
  return lines;
}

function renderEmptyExpanded(innerW: number, theme: any): string[] {
  return [
    "",
    theme.fg("accent", " 📊 dteam worker 进度"),
    theme.fg("borderMuted", "─".repeat(innerW)),
    theme.fg("muted", "  （无 worker 正在工作）"),
    "",
    theme.fg("dim", '  启动 worker：让主 LLM 调 dteam(action="run", goal="...")'),
    theme.fg("borderMuted", "─".repeat(innerW)),
    theme.fg("dim", "  再输 /dteam close 关闭面板"),
    "",
  ];
}

function renderActiveTab(state: UIState, width: number, theme: any): string[] {
  const tab = CONTENT_TABS[activeTabIdx]?.key ?? "overview";
  if (tab === "batches") return renderBatches(state, width, theme);
  if (tab === "workers") return renderWorkers(state, width, theme);
  if (tab === "signals") return renderSignals(state, width, theme);
  if (tab === "report") return renderReport(state, width, theme);
  return renderOverview(state, width, theme);
}

function renderCollapsed(state: UIState, width: number, theme: any): string[] {
  if (!state.goal) return [];
  const workers = realWorkers(state);
  const done = workers.filter((worker) => worker.status === "done").length;
  const failed = workers.filter((worker) => worker.status === "failed" || worker.status === "error").length;
  const mode = state.mode ? `[${state.mode}] ` : "";
  const summary = failed > 0 ? `${done}/${workers.length} done · ${failed} failed` : `${done}/${workers.length} done`;
  const lines = [theme.fg("accent", `● dteam ${mode}${summary} · ${formatDuration(elapsedForRun(state))}`)];
  const delayed = delayedStepIndexes(state.scheduling);
  const visibleWorkers = prioritizeWorkers(workers).slice(0, 6);
  visibleWorkers.forEach((worker, index) => {
    const branch = index === visibleWorkers.length - 1 ? "└" : "├";
    const cont = index === visibleWorkers.length - 1 ? "  " : "│ ";
    lines.push(renderCompactWorkerLine(worker, branch, width, theme));
    if (worker.status === "running" && latestOutputLine(worker)) {
      lines.push(theme.fg("muted", `${cont}  ⎿ ${latestOutputLine(worker)}`));
    }
    const stepIndex = stepIndexFromWorker(worker);
    if (stepIndex !== null && delayed.has(stepIndex)) lines.push(theme.fg("warning", `${cont}  ↳ delayed: ${delayed.get(stepIndex)}`));
  });
  if (workers.length > visibleWorkers.length) lines.push(theme.fg("dim", `└ … ${workers.length - visibleWorkers.length} more`));
  return lines;
}

function buildComponent(): (_tui: unknown, theme: any) => { render(w: number): string[]; invalidate(): void } {
  return (_tui: unknown, theme: any) => ({
    render(width: number) {
      const state = uiStore.getState();
      const innerW = Math.max(20, width - 4);
      const lines = panelExpanded ? renderExpanded(state, width, innerW, theme) : renderCollapsed(state, width, theme);
      return lines.map((line) => truncateToWidth(line, width, "…"));
    },
    invalidate() {},
  });
}

export function renderWidget(ctx: any): void {
  if (!ctx.hasUI) return;
  ctx.ui.setWidget(WIDGET_KEY, buildComponent());
  lastFingerprint = computeFingerprint(uiStore.getState());
  lastTimeRender = Date.now();
}

function computeFingerprint(state: UIState): string {
  return JSON.stringify({
    goal: state.goal,
    mode: state.mode,
    planReason: state.planReason,
    finishedAt: state.finishedAt,
    scheduling: state.scheduling,
    workers: state.workers.map((worker) => ({
      id: worker.id,
      parentId: worker.parentId,
      title: worker.title,
      status: worker.status,
      output: worker.recentOutput,
      signalCount: worker.signals.length,
      currentTool: worker.currentTool,
      files: worker.files,
    })),
    strategyCount: state.strategies.length,
  });
}

export function renderWidgetIfChanged(ctx: any, intervalMs = 1000): void {
  if (!ctx.hasUI) return;
  const state = uiStore.getState();
  const now = Date.now();
  const fp = computeFingerprint(state);
  if (fp !== lastFingerprint || now - lastTimeRender >= intervalMs) {
    lastFingerprint = fp;
    lastTimeRender = now;
    ctx.ui.setWidget(WIDGET_KEY, buildComponent());
  }
}

export function clearWidget(ctx: any): void {
  panelExpanded = false;
  if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
}

export function handlePanelCommand(args: string | undefined, ctx: any): void {
  if (!ctx.hasUI) return;
  if (args === "close") {
    panelExpanded = false;
    if (uiStore.getState().goal) renderWidget(ctx);
    else ctx.ui.setWidget(WIDGET_KEY, undefined);
    return;
  }
  const tabNum = parseInt(args ?? "", 10);
  if (!Number.isNaN(tabNum)) {
    panelExpanded = true;
    activeTabIdx = Math.max(0, Math.min(tabNum, CONTENT_TABS.length - 1));
    renderWidget(ctx);
    return;
  }
  panelExpanded = !panelExpanded;
  if (panelExpanded) activeTabIdx = 0;
  if (uiStore.getState().goal || panelExpanded) renderWidget(ctx);
  else ctx.ui.setWidget(WIDGET_KEY, undefined);
}
