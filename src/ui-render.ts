/**
 * ui-render.ts — Pure rendering utilities for dteam v1 TUI widgets.
 * All functions are side-effect-free with no external dependencies.
 */

/** Status emoji map for task states */
export function statusIcon(status: string): string {
  const icons: Record<string, string> = {
    pending: "◦",
    running: "⚒",
    done: "✓",
    failed: "✗",
    in_progress: "⚒",
    decomposed: "✓",
  };
  return icons[status] ?? "?";
}

/** Return uppercase label for a status string */
export function statusLabel(status: string): string {
  return status.toUpperCase();
}

/**
 * Format milliseconds into a human-readable duration string.
 * <60s → "Xs", otherwise → "Xm Ys"
 */
export function formatDuration(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  if (totalSec < 60) {
    return `${totalSec}s`;
  }
  const min = Math.floor(totalSec / 60);
  const sec = totalSec % 60;
  return `${min}m ${sec}s`;
}

/**
 * Truncate text to maxLen characters, appending "..." if truncated.
 */
export function truncText(text: string, maxLen: number): string {
  if (text.length <= maxLen) {
    return text;
  }
  return text.slice(0, maxLen - 3) + "...";
}

/**
 * Format a progress summary string: "X/Y done, Z failed"
 */
export function formatSummary(done: number, total: number, failed: number): string {
  return `${done}/${total} done, ${failed} failed`;
}
