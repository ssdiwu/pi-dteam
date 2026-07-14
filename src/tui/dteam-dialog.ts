import type { WorkerSnapshot } from "../runtime/types.js";

export function renderWorkerList(items: WorkerSnapshot[], theme?: any, selected = 0, width = 80): string[] {
  const title = theme?.fg ? theme.fg("accent", theme.bold("dteam workers")) : "dteam workers";
  const lines = [title, ""];
  if (items.length === 0) lines.push("(no workers)");
  for (const [index, item] of items.entries()) {
    const marker = index === selected ? ">" : " ";
    const trail = item.fallbackTrail.length > 1 ? ` ${item.fallbackTrail.join(" → ")}` : ` ${item.activeTier}`;
    const elapsed = item.startedAt ? `${Math.max(0, (item.endedAt ?? Date.now()) - item.startedAt)}ms` : "queued";
    const line = `${marker} ${item.title} [${item.id}] ${item.state}${trail} ${elapsed}`;
    lines.push(theme?.fg ? theme.fg(index === selected ? "accent" : "text", line.slice(0, width)) : line.slice(0, width));
    if (item.latestFinding) lines.push(`    finding: ${item.latestFinding}`);
  }
  lines.push("", "↑/↓ or j/k select · Enter details · Esc close");
  return lines;
}

export function renderWorkerDetail(item: WorkerSnapshot, theme?: any, width = 80): string[] {
  const color = (name: string, text: string) => theme?.fg ? theme.fg(name, text) : text;
  return [
    color("accent", theme?.bold?.(`dteam / ${item.title}`) ?? `dteam / ${item.title}`),
    "",
    `id: ${item.id}`,
    `state: ${item.state}`,
    `tier: ${item.requestedTier} → ${item.activeTier}`,
    `tools: ${item.activeTools.join(", ")}`,
    `task: ${item.task}`.slice(0, width),
    ...(item.latestFinding ? [`finding: ${item.latestFinding}`] : []),
    ...(item.result ? [`result: ${item.result}`] : []),
    ...(item.error ? [`error: ${item.error}`] : []),
    "",
    ...(["queued", "running", "waiting"].includes(item.state) ? ["s steering · c cancel (confirm) · Esc back"] : ["read-only archive · Esc back"]),
  ];
}
