/**
 * dteam/orchestrator/signal-handlers.ts — signal listener 注册
 *
 * 【重构方案】Phase 4：
 *   - 4a 抽 signal-handlers：run() 主体从 ~100 行缩到 < 70 行
 *   - 4b 抽 help-self-heal：help 自愈逻辑搬到 ./help-self-heal.ts
 *   - 4c 抽 peer-forwarder：found/progress 实时转发搬到 ./peer-forwarder.ts
 *
 * 行为零变化：reporter 默认实现委托 uiStore（与之前直接调 uiStore 等价）。
 * forwardSignalToPeers 现位于 ./peer-forwarder.ts，reporter 作为参数传入（修 O-8）。
 */

import { defaultReporter } from "../reporter.js";
import { forwardSignalToPeers } from "./peer-forwarder.js";
import { handleHelpSignal } from "./help-self-heal.js";
import type { Reporter } from "../reporter.js";
import type { DteamContext } from "../types/context.js";
import type { Signal } from "../types/signal.js";
import type { IRunsStore } from "../types/run.js";
import type { UIStore } from "../ui/store.js";

/**
 * 安装 6 路 signal listener（progress x2 / found x2 / blocked / help）。
 *
 * 返回 `uninstall` 闭包，用于在 run() 结束时一次性清理所有 listener。
 *
 * 【行为】与重构前完全一致：
 *  - progress / found / blocked → UI 更新（走 reporter；reporter 默认实现 = uiStore）
 *  - found / progress（限流）→ 实时转发给同 run 下其他 running worker
 *  - help → 1 次自愈（派 explore 补充）+ 第 2 次升级到人类（ctx.ui.notify）
 *  - help 自愈实现位于 ./help-self-heal.ts（4b 抽）
 *
 * @param dteam          dteam 上下文（signalBus / pendingSupplements / runsStore）
 * @param ctx            外部 ctx（用于 ctx.ui.notify 通知用户）
 * @param goal           全局目标（help 自愈时拼 prompt 用）
 * @param helpSelfHealed 跨 help 调用共享的"已自愈 workerId"集合
 * @param uiStore        占位参数（保留以备未来扩展；本函数内通过 reporter 间接使用 uiStore）
 * @param runsStore      占位参数（保留以备未来扩展；本函数内通过 dteam.runsStore 访问）
 */
export function installSignalHandlers(
  dteam: DteamContext,
  ctx: any,
  goal: string,
  helpSelfHealed: Set<string>,
  uiStore: UIStore,
  runsStore: IRunsStore,
): () => void {
  // reporter：ctx.reporter ?? defaultReporter
  // 行为零变化：defaultReporter 每个方法内部直接委托 uiStore 同样方法
  const reporter: Reporter = ctx.reporter ?? defaultReporter;

  const unsubs: (() => void)[] = [];

  // ─── 1) progress → UI 更新 ───
  unsubs.push(
    dteam.signalBus.on("progress", (s) => {
      const data = s.data as any;
      const msg = data.summary ?? data.action ?? "";
      reporter.updateWorker(s.workerId, { recentOutput: msg.slice(0, 200) });
      reporter.addSignal(s.workerId, {
        type: "progress",
        workerId: s.workerId,
        summary: msg,
        timestamp: s.timestamp,
      });
    }),
  );

  // ─── 2) found → UI 更新 ───
  unsubs.push(
    dteam.signalBus.on("found", (s) => {
      const data = s.data as any;
      const msg = `发现: ${data.summary ?? ""}`;
      reporter.updateWorker(s.workerId, { recentOutput: msg.slice(0, 200) });
      reporter.addSignal(s.workerId, {
        type: "found",
        workerId: s.workerId,
        summary: data.summary ?? "",
        timestamp: s.timestamp,
      });
    }),
  );

  // ─── 3) blocked → UI 更新 ───
  unsubs.push(
    dteam.signalBus.on("blocked", (s) => {
      const data = s.data as any;
      const msg = `阻塞: ${data.message ?? ""}`;
      reporter.updateWorker(s.workerId, { recentOutput: msg.slice(0, 200) });
      reporter.addSignal(s.workerId, {
        type: "blocked",
        workerId: s.workerId,
        summary: data.message ?? "",
        timestamp: s.timestamp,
      });
    }),
  );

  // ─── 4) found → 实时转发给同 run 下其他 running worker ───
  // 【重构方案】Phase 4 - 4c：转发实现搬到 ./peer-forwarder.ts，传入 reporter（修 O-8）
  unsubs.push(
    dteam.signalBus.on("found", (s) => {
      forwardSignalToPeers(dteam, s, s.data as any, reporter);
    }),
  );

  // ─── 5) progress（限流）→ 实时转发 ───
  // 【重构方案】Phase 4 - 4c：转发实现搬到 ./peer-forwarder.ts，传入 reporter（修 O-8）
  unsubs.push(
    dteam.signalBus.on("progress", (s) => {
      const data = s.data as any;
      const summary = data.summary ?? data.action ?? "";
      // 限流：仅转发带动作词的 progress
      if (/完成|新建|修改|创建|delete|create|modify|done/i.test(summary)) {
        forwardSignalToPeers(dteam, s, data, reporter);
      }
    }),
  );

  // ─── 6) help → 1 次自愈 + 第 2 次升级到人类 ───
  // 【重构方案】Phase 4 - 4b：help 自愈逻辑抽到 help-self-heal.ts
  unsubs.push(
    dteam.signalBus.on("help", (s) => {
      handleHelpSignal(s, dteam, ctx, goal, helpSelfHealed, reporter);
    }),
  );

  // 统一返回 uninstall 闭包
  return () => {
    for (const unsub of unsubs) unsub();
  };
}
