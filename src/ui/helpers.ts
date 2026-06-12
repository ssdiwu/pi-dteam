/**
 * ui/helpers.ts — 纯渲染工具函数
 *
 * 零状态、零副作用，供 widget 和 panel 共享。
 */

/** 状态→图标 */
export function statusIcon(s: string): string {
  return (
    { idle: "○", pending: "○", running: "◐", done: "✓", failed: "✕", error: "✕", delayed: "↳", in_progress: "◐", decomposed: "✓" }[s] ??
    "?"
  );
}

/** 状态→主题色 */
export function statusColor(s: string): string {
  return (
    { idle: "muted", pending: "muted", running: "accent", done: "dim", failed: "error", error: "error", delayed: "warning", in_progress: "accent" }[s] ??
    "muted"
  );
}

/** 删除线文本（用于 done worker 低噪声显示） */
export function strike(text: string): string {
  return text.split("").map((ch) => `${ch}\u0336`).join("");
}

/** 毫秒→可读时长 */
export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

/** 信号类型→图标 */
export function signalIcon(type: string): string {
  return (
    { progress: "📤", found: "💡", blocked: "🚫", help: "🆘" }[type] ?? "•"
  );
}

/** 信号类型→中文标签 */
export function signalLabel(type: string): string {
  return (
    { progress: "进度", found: "发现", blocked: "阻塞", help: "求助" }[type] ?? type
  );
}
