/**
 * ui/helpers.ts — 纯渲染工具函数
 *
 * 零状态、零副作用，供 widget 和 panel 共享。
 */

/** 状态→图标 */
export function statusIcon(s: string): string {
  return (
    { pending: "◦", running: "⚒", done: "✓", failed: "✗", in_progress: "⚒", decomposed: "✓" }[s] ??
    "?"
  );
}

/** 毫秒→可读时长 */
export function formatDuration(ms: number): string {
  const sec = Math.floor(ms / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}
