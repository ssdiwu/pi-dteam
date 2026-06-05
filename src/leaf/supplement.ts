/**
 * dteam/leaf/supplement.ts — 根注入补充信息等待
 *
 * 【重构方案】Phase 3 - C 拆出。修 L-5：setTimeout 引用闭包化，resolve 时主动 clearTimeout。
 *
 * 优先消费 injectionQueue（根转发），空时调 setPending（help 自愈路径）。
 * 【暂不改 L-4 队列式】——会破坏 orchestrator 接口，合并到 Phase 4 处理。
 */

import type { DteamContext } from "../types/context.js";

/**
 * 等待根注入补充信息。
 *  1. 先看 injectionQueue（根转发的发现/进度），有则同步取出
 *  2. 队列空 → 调 resolver 入 pendingSupplements，Promise 等待
 *  3. timeoutMs 超时自动 resolve(null) 让叶子退出循环
 * 返回 null：超时或队列空。
 */
export function waitForSupplement(
  dteam: DteamContext,
  workerId: string,
  timeoutMs: number,
): Promise<string | null> {
  // 1. 优先消费 injectionQueue
  const queue = dteam.injectionQueue.get(workerId);
  if (queue && queue.length > 0) {
    return Promise.resolve(queue.shift() ?? null);
  }

  // 2. 队列空 → 调 resolver，等待 Promise
  return new Promise((resolve) => {
    const resolver = (value: string | null) => {
      // resolve 时主动 clearTimeout，避免 timer 引用泄漏（L-5）
      clearTimeout(timer);
      resolve(value);
    };
    dteam.pendingSupplements.set(workerId, resolver);

    const timer = setTimeout(() => {
      if (dteam.pendingSupplements.has(workerId)) {
        dteam.pendingSupplements.delete(workerId);
      }
      resolve(null);
    }, timeoutMs);
  });
}
