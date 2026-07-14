import type { Theme } from "@earendil-works/pi-coding-agent";
import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import type { WorkerSnapshot } from "../runtime/types.js";
import { formatDuration } from "../duration.js";
import { t, type Translate } from "./i18n.js";

type ThemeLike = Pick<Theme, "fg" | "bold">;
type ThemeColor = Parameters<Theme["fg"]>[0];

export function renderWorkerList(items: WorkerSnapshot[], theme?: ThemeLike, selected = 0, width = 80, translate: Translate = t): string[] {
  const active = items.filter((item) => ["queued", "running", "waiting"].includes(item.state)).length;
  const lines = [
    paint(theme, "muted", translate("dialog.count", { count: items.length, active })),
    "",
  ];

  if (items.length === 0) {
    lines.push(paint(theme, "muted", translate("dialog.noWorkers")));
  } else {
    for (const [index, item] of items.entries()) {
      const marker = index === selected ? "▶" : " ";
      const tier = item.requestedTier === item.activeTier ? item.activeTier : `${item.requestedTier} → ${item.activeTier}`;
      lines.push(`${marker} ${safeText(item.title) || translate("dialog.untitled")}`);
      lines.push(`  ${translate(`state.${item.state}`)} · ${translate("dialog.tier", { value: tier })} · ${translate("dialog.elapsed", { value: elapsed(item, translate) })}`);
      if (item.liveTool) lines.push(`  ${translate("dialog.liveTool", { value: safeText(item.liveTool) })}`);
      if (item.liveText) lines.push(`  ${translate("dialog.liveText", { value: safeText(item.liveText) })}`);
      if (item.liveThinking) lines.push(`  ${translate("dialog.liveThinking", { value: safeText(item.liveThinking) })}`);
      if (item.lastActivity) lines.push(`  ${translate("dialog.lastActivity", { value: safeText(item.lastActivity) })}`);
      if (item.timeoutDiagnostic) lines.push(`  ${timeoutLabel(item, translate)}`);
      lines.push(`  ${translate("dialog.task", { value: safeText(item.task) || translate("dialog.noTask") })}`);
      if (item.latestFinding) lines.push(`  ${translate("dialog.finding", { value: safeText(item.latestFinding) })}`);
      if (item.error) lines.push(`  ${translate("dialog.error", { value: safeText(item.error) })}`);
      if (index < items.length - 1) lines.push("");
    }
  }

  lines.push("", paint(theme, "dim", translate("dialog.controls.list")));
  return frame(lines, translate("dialog.listTitle"), theme, width);
}

export function renderWorkerDetail(item: WorkerSnapshot, theme?: ThemeLike, width = 80, translate: Translate = t): string[] {
  const active = ["queued", "running", "waiting"].includes(item.state);
  const lines = [
    translate("dialog.id", { value: safeText(item.id) }),
    translate("dialog.state", { value: translate(`state.${item.state}`) }),
    translate("dialog.tier", { value: `${item.requestedTier} → ${item.activeTier}` }),
    translate("dialog.elapsed", { value: elapsed(item, translate) }),
    translate("dialog.tools", { value: item.activeTools.map(safeText).join(", ") || translate("dialog.none") }),
    translate("dialog.fallback", { value: item.fallbackTrail.length > 1 ? item.fallbackTrail.map(safeText).join(" → ") : translate("dialog.none") }),
    translate("dialog.task", { value: safeText(item.task) || translate("dialog.noTask") }),
    ...(item.liveText ? [translate("dialog.liveText", { value: safeText(item.liveText) })] : []),
    ...(item.liveThinking ? [translate("dialog.liveThinking", { value: safeText(item.liveThinking) })] : []),
    ...(item.liveTool ? [translate("dialog.liveTool", { value: safeText(item.liveTool) })] : []),
    ...(item.lastActivity ? [translate("dialog.lastActivity", { value: safeText(item.lastActivity) })] : []),
    ...(item.timeoutDiagnostic ? [timeoutLabel(item, translate), translate("dialog.timeoutOutput", { value: safeText(item.timeoutDiagnostic.outputSummary) })] : []),
    ...(item.latestFinding ? [translate("dialog.finding", { value: safeText(item.latestFinding) })] : []),
    ...(item.result ? [translate("dialog.result", { value: safeText(item.result) })] : []),
    ...(item.error ? [translate("dialog.error", { value: safeText(item.error) })] : []),
    "",
    paint(theme, "dim", translate(active ? "dialog.controls.running" : "dialog.controls.archive")),
  ];
  return frame(lines, translate("dialog.detailTitle", { title: safeText(item.title) || translate("dialog.untitled") }), theme, width);
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
