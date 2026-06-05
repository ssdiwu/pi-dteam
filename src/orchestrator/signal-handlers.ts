/**
 * dteam/orchestrator/signal-handlers.ts — 4 路 signal listener 注册
 *
 * 【重构方案】Phase 4 - 4a 抽 signal-handlers。
 * 修 O-1：run() 主体从 ~100 行缩到 < 70 行。
 *
 * 行为零变化：reporter 默认实现委托 uiStore（与之前直接调 uiStore 等价）。
 * forwardSignalToPeers 暂仍在本文件内调用（Phase 4c 再抽）。
 * help 自愈的 handleHelpSignals 函数暂仍在本文件内（Phase 4b 再抽）。
 */

import { defaultReporter } from "../reporter.js";
import { execute as runSolo } from "../leaf.js";
import { forwardSignalToPeers } from "../orchestrator.js";
import type { Reporter } from "../reporter.js";
import type { DteamContext } from "../types/context.js";
import type { Signal } from "../types/signal.js";
import type { IRunsStore } from "../types/run.js";
import type { UIStore } from "../ui/store.js";

/**
 * 安装 4 路 signal listener（progress / found / blocked / help）。
 *
 * 返回 `uninstall` 闭包，用于在 run() 结束时一次性清理所有 listener。
 *
 * 【行为】与重构前完全一致：
 *  - progress / found / blocked → UI 更新（走 reporter；reporter 默认实现 = uiStore）
 *  - found / progress（限流）→ 实时转发给同 run 下其他 running worker
 *  - help → 1 次自愈（派 explore 补充）+ 第 2 次升级到人类（ctx.ui.notify）
 *
 * @param dteam          dteam 上下文（signalBus / pendingSupplements / runsStore）
 * @param ctx            外部 ctx（用于 ctx.ui.notify 通知用户）
 * @param goal           全局目标（help 自愈时拼 prompt 用）
 * @param helpSelfHealed 跨 help 调用共享的"已自愈 workerId"集合
 * @param uiStore        占位参数（保留以备 Phase 4b 扩展；本函数内通过 reporter 间接使用 uiStore）
 * @param runsStore      占位参数（保留以备 Phase 4c 扩展；本函数内通过 dteam.runsStore 访问）
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
  unsubs.push(
    dteam.signalBus.on("found", (s) => {
      forwardSignalToPeers(dteam, s, s.data as any);
    }),
  );

  // ─── 5) progress（限流）→ 实时转发 ───
  unsubs.push(
    dteam.signalBus.on("progress", (s) => {
      const data = s.data as any;
      const summary = data.summary ?? data.action ?? "";
      // 限流：仅转发带动作词的 progress
      if (/完成|新建|修改|创建|delete|create|modify|done/i.test(summary)) {
        forwardSignalToPeers(dteam, s, data);
      }
    }),
  );

  // ─── 6) help → 1 次自愈 + 第 2 次升级到人类 ───
  unsubs.push(
    dteam.signalBus.on("help", async (s) => {
      const data = s.data as any;
      const msg = `求助: ${data.whatMissing ?? ""}`;
      reporter.updateWorker(s.workerId, { recentOutput: msg.slice(0, 200) });
      reporter.addSignal(s.workerId, {
        type: "help",
        workerId: s.workerId,
        summary: data.whatMissing ?? "",
        timestamp: s.timestamp,
      });

      // 已经自愈过 1 次 → 升级到人类
      if (helpSelfHealed.has(s.workerId)) {
        reporter.addStrategy({
          action: "升级到人类",
          target: s.workerId,
          detail: `自愈后仍需帮助: ${data.whatMissing ?? ""}`,
          timestamp: Date.now(),
        });
        // 通知用户，不 resolve → 叶子继续等
        // 等用户通过 dteam(action="continue") 注入
        try {
          ctx.ui.notify(
            `🆘 dteam 需要你的判断（run ${dteam.runId}）:\n` +
            `叶子 ${s.workerId} 需要帮助: ${data.whatMissing ?? "未知"}\n` +
            `上下文: ${data.context ?? ""}\n` +
            `请在回复中说 /dteam continue`,
            "warning",
          );
        } catch { /* ui 可能不可用 */ }
        return;
      }

      // 首次 help → 自愈 1 次
      helpSelfHealed.add(s.workerId);
      try {
        const supplementTask = [
          `## 主目标: ${goal}`,
          `## Worker 求助`,
          `- 缺什么: ${data.whatMissing ?? "未知"}`,
          `- 上下文: ${data.context ?? ""}`,
          `- 建议方向: ${data.suggestedDirection ?? "无"}`,
          ``,
          `请搜索和收集缺失信息，输出简洁的补充报告。`,
        ].join("\n");
        const supplement = await runSolo("explore", supplementTask, ctx, goal);
        reporter.addStrategy({
          action: "help自愈",
          target: `explore → ${s.workerId}`,
          detail: `补充: ${data.whatMissing ?? ""}`,
          timestamp: Date.now(),
        });
        const resolve = dteam.pendingSupplements.get(s.workerId);
        if (resolve) {
          dteam.pendingSupplements.delete(s.workerId);
          resolve(supplement);
        }
      } catch {
        const resolve = dteam.pendingSupplements.get(s.workerId);
        if (resolve) {
          dteam.pendingSupplements.delete(s.workerId);
          resolve(null);
        }
      }
    }),
  );

  // 统一返回 uninstall 闭包
  return () => {
    for (const unsub of unsubs) unsub();
  };
}
