/**
 * 信号工具
 *
 * 提供信号的发送和监听接口
 */

import { SignalBus } from "../P1/signalBus.js";
import { bus } from "./worker.js";

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * signal.emit — 发送信号
 */
export async function signalEmit(
  ctx: { cwd: string },
  params: { type: string; workerId: string; data?: Record<string, unknown> },
): Promise<{ content: string }> {
  const { type, workerId, data = {} } = params;
  const signal = bus.emit(type as any, workerId, data);

  return {
    content: JSON.stringify({
      signal,
      message: `Signal emitted: ${type}`,
    }),
  };
}

/**
 * signal.history — 获取信号历史
 */
export async function signalHistory(
  ctx: { cwd: string },
  params: { workerId?: string },
): Promise<{ content: string }> {
  const { workerId } = params;
  const history = bus.getHistory(workerId);

  return {
    content: JSON.stringify({
      history,
      count: history.length,
      message: `Found ${history.length} signals`,
    }),
  };
}
