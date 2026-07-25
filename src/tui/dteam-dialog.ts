import type { Theme } from "@earendil-works/pi-coding-agent";
import { matchesKey, truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { WorkerReport, WorkerSnapshot } from "../runtime/types.js";
import { formatDuration } from "../duration.js";
import { t, type Translate } from "./i18n.js";

type ThemeLike = Pick<Theme, "fg" | "bold">;
type ThemeColor = Parameters<Theme["fg"]>[0];

export type WorkerView = "active" | "history";

const ACTIVE_STATES = new Set<WorkerSnapshot["state"]>(["queued", "running", "waiting"]);
const LIST_VIEWPORT_ROWS = 14;
const DETAIL_VIEWPORT_ROWS = 16;

export function workersForView(items: WorkerSnapshot[], view: WorkerView): WorkerSnapshot[] {
  const matching = items.filter((item) => ACTIVE_STATES.has(item.state) === (view === "active"));
  return view === "history" ? matching.sort((left, right) => terminalTimestamp(right) - terminalTimestamp(left)) : matching;
}

export function clampSelection(selected: number, count: number): number {
  return Math.max(0, Math.min(selected, Math.max(0, count - 1)));
}

export function scrollOffsetForSelection(selected: number, count: number, viewportRows = LIST_VIEWPORT_ROWS): number {
  const safeSelected = clampSelection(selected, count);
  return Math.min(Math.max(0, safeSelected - viewportRows + 1), Math.max(0, count - viewportRows));
}

export function nextWorkerSelection(data: string, current: number, count: number): number | null {
  return nextOffset(data, current, Math.max(0, count - 1));
}

export function nextScrollOffset(data: string, current: number, totalLines: number, viewportRows = DETAIL_VIEWPORT_ROWS): number | null {
  return nextOffset(data, current, Math.max(0, totalLines - viewportRows));
}

function nextOffset(data: string, current: number, max: number): number | null {
  if (matchesKey(data, "down") || data === "j") return Math.min(current + 1, max);
  if (matchesKey(data, "up") || data === "k") return Math.max(current - 1, 0);
  if (matchesKey(data, "pageDown") || matchesKey(data, "ctrl+d")) return Math.min(current + 10, max);
  if (matchesKey(data, "pageUp") || matchesKey(data, "ctrl+u")) return Math.max(current - 10, 0);
  if (matchesKey(data, "end") || data === "G") return max;
  if (matchesKey(data, "home") || data === "g") return 0;
  return null;
}

export function renderWorkerList(items: WorkerSnapshot[], theme?: ThemeLike, selected = 0, width = 80, translate: Translate = t, view: WorkerView = "active"): string[] {
  const active = workersForView(items, "active");
  const history = workersForView(items, "history");
  const visibleItems = view === "active" ? active : history;
  const safeSelected = clampSelection(selected, visibleItems.length);
  const offset = scrollOffsetForSelection(safeSelected, visibleItems.length);
  const tab = `${view === "active" ? "●" : "○"} ${translate("dialog.tabActive", { count: active.length })}   ${view === "history" ? "●" : "○"} ${translate("dialog.tabHistory", { count: history.length })}`;
  const lines = [tab, paint(theme, "muted", translate("dialog.count", { count: visibleItems.length, active: active.length })), ""];

  if (visibleItems.length === 0) {
    lines.push(paint(theme, "muted", translate(view === "active" ? "dialog.noActiveWorkers" : "dialog.noHistoryWorkers")));
  } else {
    for (const [index, item] of visibleItems.slice(offset, offset + LIST_VIEWPORT_ROWS).entries()) {
      lines.push(compactWorkerLine(item, offset + index === safeSelected, translate));
    }
  }

  lines.push("", rangeLabel(offset, visibleItems.length, LIST_VIEWPORT_ROWS, translate), paint(theme, "dim", translate("dialog.controls.list")));
  return frame(lines, translate("dialog.listTitle"), theme, width);
}

export function renderWorkerFallback(items: WorkerSnapshot[], theme?: ThemeLike, width = 80, translate: Translate = t): string[] {
  return [
    ...renderWorkerList(items, theme, 0, width, translate, "active"),
    "",
    ...renderWorkerList(items, theme, 0, width, translate, "history"),
  ];
}

export function renderWorkerDetail(item: WorkerSnapshot, theme?: ThemeLike, width = 80, translate: Translate = t, offset = 0): string[] {
  const active = ACTIVE_STATES.has(item.state);
  const content = [
    translate("dialog.id", { value: safeText(item.id) }),
    translate("dialog.state", { value: translate(`state.${item.state}`) }),
    translate("dialog.tier", { value: `${item.requestedTier} → ${item.activeTier}` }),
    translate("dialog.elapsed", { value: elapsed(item, translate) }),
    translate("dialog.tools", { value: item.activeTools.map(safeText).join(", ") || translate("dialog.none") }),
    translate("dialog.fallback", { value: item.fallbackTrail.length > 1 ? item.fallbackTrail.map(safeText).join(" → ") : translate("dialog.none") }),
    translate("dialog.task", { value: safeText(item.task) || translate("dialog.noTask") }),
    ...(item.writeScope?.length ? [translate("dialog.writeScope", { value: item.writeScope.map(safeText).join(", ") })] : []),
    ...(item.liveText ? [translate("dialog.liveText", { value: safeText(item.liveText) })] : []),
    ...(item.liveThinking ? [translate("dialog.liveThinking", { value: safeText(item.liveThinking) })] : []),
    ...(item.liveTool ? [translate("dialog.liveTool", { value: safeText(item.liveTool) })] : []),
    ...(item.lastActivity ? [translate("dialog.lastActivity", { value: safeText(item.lastActivity) })] : []),
    ...(item.timeoutDiagnostic ? [timeoutLabel(item, translate), translate("dialog.timeoutOutput", { value: safeText(item.timeoutDiagnostic.outputSummary) })] : []),
    ...(item.report ? reportDetailLines(item.report, translate) : item.latestFinding ? [translate("dialog.finding", { value: safeText(item.latestFinding) })] : []),
    ...(item.result ? [translate("dialog.result", { value: safeText(item.result) })] : []),
    ...(item.error ? [translate("dialog.error", { value: safeText(item.error) })] : []),
  ];
  const safeOffset = Math.min(Math.max(0, offset), Math.max(0, content.length - DETAIL_VIEWPORT_ROWS));
  const lines = [...content.slice(safeOffset, safeOffset + DETAIL_VIEWPORT_ROWS), "", rangeLabel(safeOffset, content.length, DETAIL_VIEWPORT_ROWS, translate), paint(theme, "dim", translate(active ? "dialog.controls.running" : "dialog.controls.archive"))];
  return frame(lines, translate("dialog.detailTitle", { title: safeText(item.title) || translate("dialog.untitled") }), theme, width);
}

export function detailLineCount(item: WorkerSnapshot, translate: Translate = t): number {
  return renderWorkerDetail(item, undefined, 10_000, translate).length - 5;
}

function terminalTimestamp(item: WorkerSnapshot): number {
  return item.endedAt ?? item.startedAt ?? 0;
}

function compactWorkerLine(item: WorkerSnapshot, selected: boolean, translate: Translate): string {
  const marker = selected ? "▶" : " ";
  const tier = item.requestedTier === item.activeTier ? item.activeTier : `${item.requestedTier} → ${item.activeTier}`;
  const activity = item.liveTool ? translate("dialog.compactTool", { value: safeText(item.liveTool) }) : item.lastActivity ? safeText(item.lastActivity) : "";
  return `${marker} ${safeText(item.title) || translate("dialog.untitled")} · ${translate(`state.${item.state}`)} · ${tier} · ${elapsed(item, translate)}${activity ? ` · ${activity}` : ""}`;
}

function rangeLabel(offset: number, total: number, viewportRows: number, translate: Translate): string {
  if (total <= viewportRows) return "";
  return translate("dialog.range", { start: offset + 1, end: Math.min(total, offset + viewportRows), total });
}

function safeText(value: string): string {
  return value
    .replace(/\r\n?|\n/g, " ↵ ")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "�");
}

function elapsed(item: WorkerSnapshot, translate: Translate = t): string {
  if (!item.startedAt) return translate("state.queued");
  return formatDuration(Math.max(0, (item.endedAt ?? Date.now()) - item.startedAt));
}

function timeoutLabel(item: WorkerSnapshot, translate: Translate): string {
  const diagnostic = item.timeoutDiagnostic!;
  return translate("dialog.timeout", {
    attemptBudget: formatDuration(diagnostic.attemptBudgetMs),
    maxBudget: formatDuration(diagnostic.maxRecoveryBudgetMs),
    elapsed: formatDuration(diagnostic.elapsedMs),
    lastActivity: safeText(diagnostic.lastActivity),
    currentTool: safeText(diagnostic.currentTool),
  });
}

function reportDetailLines(report: WorkerReport, translate: Translate): string[] {
  const lines = [
    translate("dialog.reportSummary", { outcome: report.outcome, value: safeText(report.summary) }),
    translate("dialog.reportActivities", { value: report.activities.map(safeText).join(", ") }),
    translate("dialog.reportVerification", { depth: report.verification.depth, status: report.verification.status }),
  ];
  for (const evidence of report.verification.evidence) lines.push(translate("dialog.reportEvidence", { value: safeText(evidence) }));
  for (const remaining of report.verification.remaining ?? []) lines.push(translate("dialog.reportRemaining", { value: safeText(remaining) }));
  for (const fact of report.facts) lines.push(translate("dialog.reportFact", { claim: safeText(fact.claim), evidence: safeText(fact.evidence) }));
  for (const uncertainty of report.uncertainties ?? []) lines.push(translate("dialog.reportUncertainty", { value: safeText(uncertainty) }));
  return lines;
}

function paint(theme: ThemeLike | undefined, name: ThemeColor, text: string): string {
  return typeof theme?.fg === "function" ? theme.fg(name, text) : text;
}

function bold(theme: ThemeLike | undefined, text: string): string {
  return typeof theme?.bold === "function" ? theme.bold(text) : text;
}

function frame(lines: string[], title: string, theme: ThemeLike | undefined, width: number): string[] {
  const innerWidth = Math.max(1, Math.floor(width));
  if (innerWidth === 1) return ["│"];
  const bodyWidth = innerWidth - 2;
  const titleText = truncateToWidth(` ${safeText(title)} `, bodyWidth);
  const titlePadding = Math.max(0, innerWidth - visibleWidth(titleText) - 2);
  const leftPadding = Math.floor(titlePadding / 2);
  const rightPadding = titlePadding - leftPadding;
  const border = (text: string) => paint(theme, "border", text);
  const top = border("╭" + "─".repeat(leftPadding))
    + paint(theme, "accent", bold(theme, titleText))
    + border("─".repeat(rightPadding) + "╮");
  const body = lines.map((line) => {
    const content = truncateToWidth(line.replace(/\r\n?|\n/g, " ↵ "), bodyWidth);
    const padding = " ".repeat(Math.max(0, bodyWidth - visibleWidth(content)));
    return border("│") + content + padding + border("│");
  });
  return [top, ...body, border("╰" + "─".repeat(Math.max(0, innerWidth - 2)) + "╯")];
}
