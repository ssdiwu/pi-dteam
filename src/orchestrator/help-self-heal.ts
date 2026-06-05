/**
 * dteam/orchestrator/help-self-heal.ts — help 自愈回路
 *
 * 【重构方案】Phase 4 - 4b 抽 help-self-heal。
 * 修 O-2：try { ... } catch { 静默吞 } 静默吞异常 → 改用 reporter 记录。
 *
 * 行为零变化：与之前 in-line 实现的逻辑完全相同。
 *   - 首次 help（workerId 不在 helpSelfHealed）：派 explore 收集 → resolve(supplement)
 *   - 第 2 次及之后：升级到人类（ctx.ui.notify）→ 不 resolve 让叶子继续等
 */

import { execute as runSolo } from "../leaf.js";
import type { Reporter } from "../reporter.js";
import type { DteamContext } from "../types/context.js";
import type { Signal, HelpPayload } from "../types/signal.js";

/**
 * 处理 help 信号：1 次自愈（派 explore 收集信息）+ 第 2 次升级到人类。
 *
 * 【行为】
 *  - 首次 help → 自愈 1 次：派 explore 收集信息，resolve 叶子 pendingSupplements
 *  - 第 2 次及之后 → 升级到人类：ctx.ui.notify 通知用户，不 resolve 让叶子继续等
 *  - 自愈失败 → 修 O-2：reporter.addStrategy 记录错误，仍 resolve(null) 释放叶子
 *
 * @param s              help 信号（data 必为 HelpPayload）
 * @param dteam          dteam 上下文（用于 pendingSupplements 队列 / runId）
 * @param ctx            外部 ctx（用于 ctx.ui.notify 通知用户）
 * @param goal           全局目标（拼 explore prompt 用）
 * @param helpSelfHealed 跨 help 调用共享的"已自愈 workerId"集合
 * @param reporter       reporter 抽象（updateWorker / addSignal / addStrategy）
 */
export async function handleHelpSignal(
  s: Signal,
  dteam: DteamContext,
  ctx: any,
  goal: string,
  helpSelfHealed: Set<string>,
  reporter: Reporter,
): Promise<void> {
  const data = s.data as HelpPayload;
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
  } catch (e) {
    // 修 O-2：catch 不再静默，记录错误
    reporter.addStrategy({
      action: "help自愈失败",
      target: s.workerId,
      detail: (e as Error).message,
      timestamp: Date.now(),
    });
    const resolve = dteam.pendingSupplements.get(s.workerId);
    if (resolve) {
      dteam.pendingSupplements.delete(s.workerId);
      resolve(null);
    }
  }
}
