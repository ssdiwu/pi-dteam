/**
 * dteam/orchestrator/peer-forwarder.ts — 实时转发回路
 *
 * 【重构方案】Phase 4 - 4c 抽 peer-forwarder。
 *
 * 将 found/progress 信号转发给同 run 下所有正在跑的叶子。
 * 注入方式：写入 dteam.injectionQueue[targetWorkerId] 队列。
 * 修 O-8：forwardSignalToPeers 与 ui 写入解耦——reporter 入参替换。
 *
 * 行为零变化。
 */

import { defaultReporter } from "../reporter.js";
import type { Reporter } from "../reporter.js";
import type { DteamContext } from "../types/context.js";
import type { Signal } from "../types/signal.js";

/**
 * 将一个信号转发给同 run 下所有"正在跑"的其他叶子。
 * 注入方式：写入 dteam.injectionQueue[targetWorkerId] 的入队。
 *
 * 【行为】（与重构前完全一致）
 *  - 空 summary → 早 return（不写队列、不记录 UI）
 *  - 查 `dteam.runsStore.getAllWorkers(dteam.runId)` 拿所有 worker
 *  - 过滤 `w.id !== sourceSignal.workerId`（排除发送者）
 *  - 过滤 `w.status === "running"`（只转发给 running）
 *  - 写 `dteam.injectionQueue`：先 `get(w.id) ?? []`，`push(message)`，`set(w.id, queue)`
 *  - 消息格式：`[转发 ${type} from ${workerId}] ${summary}`
 *  - UI 记录（O-8 修后）：`reporter.addStrategy({ action, target, detail, timestamp })`
 *    - `timestamp` 用 `sourceSignal.timestamp`（保持原值，不换成 `Date.now()`）
 *
 * 【可观察】测试可验证：
 *   - injectionQueue 长度 + 1（被转发的 worker 队列增长）
 *   - reporter.addStrategy 末尾出现 "转发 <type> from X → Y" 记录
 *   - 跳过发送者自身
 *
 * @param dteam         dteam 上下文（signalBus / runsStore / runId / injectionQueue）
 * @param sourceSignal  触发转发的源信号
 * @param data          源信号的 data 载荷（用于提取 summary）
 * @param reporter      reporter 抽象（默认 = defaultReporter，委托 uiStore）；
 *                      4c 起不再直接调 uiStore.addStrategy（修 O-8）
 */
export function forwardSignalToPeers(
  dteam: DteamContext,
  sourceSignal: Signal,
  data: any,
  reporter: Reporter = defaultReporter,
): void {
  const summary = data.summary ?? data.action ?? "";
  if (!summary) return;
  const message = `[转发 ${sourceSignal.type} from ${sourceSignal.workerId}] ${summary}`;

  // 查找同 run 下所有 running worker（排除发送者）
  const workers = dteam.runsStore.getAllWorkers(dteam.runId);
  for (const w of workers) {
    if (w.id === sourceSignal.workerId) continue;
    if (w.status !== "running") continue;

    // 1. 写队列（叶子轮询/下次循环会拿到）
    const queue = dteam.injectionQueue.get(w.id) ?? [];
    queue.push(message);
    dteam.injectionQueue.set(w.id, queue);

    // 2. UI 记录（修 O-8：reporter 入参替换直接 uiStore 调用）
    reporter.addStrategy({
      action: `转发 ${sourceSignal.type}`,
      target: `${sourceSignal.workerId} → ${w.id}`,
      detail: summary,
      timestamp: sourceSignal.timestamp,
    });
  }
}
