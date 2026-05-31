/**
 * 信号工具
 *
 * 提供信号的发送和监听接口
 */

import { SignalType } from "../P0/signal.js";
import { bus } from "./worker.js";

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * signal_emit — 发送信号
 */
export async function signalEmit(
  ctx: { cwd: string },
  params: { type: string; workerId: string; data?: Record<string, unknown> },
): Promise<{ content: string }> {
  const { type, workerId, data = {} } = params;
  const allowedSignals: SignalType[] = ["progress", "blocked", "found", "help"];
  if (!allowedSignals.includes(type as SignalType)) {
    return {
      content: JSON.stringify({
        error: `Invalid signal type: ${type}`,
      }),
    };
  }

  const signal = bus.emit(type as SignalType, workerId, data);

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
