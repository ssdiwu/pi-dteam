/** 将内部毫秒数格式化为用户可读的秒/分秒。 */
export function formatDuration(milliseconds: number): string {
  const totalSeconds = Math.max(0, milliseconds) / 1000;
  if (totalSeconds < 60) return `${Number(totalSeconds.toFixed(1))}s`;
  const wholeSeconds = Math.floor(totalSeconds);
  return `${Math.floor(wholeSeconds / 60)}m${wholeSeconds % 60}s`;
}
