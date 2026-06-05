/**
 * dteam/orchestrator/history-context.ts — 链式继承 history context
 *
 * 【重构方案】Phase 4 - 4d 抽 history-context。
 * 修 O-5：buildHistoryContext 时间过滤实现。
 *
 * 采集前序 step 的 found/progress 信号摘要，注入到下一个 step 的 prompt。
 */

import type { DteamContext } from "../types/context.js";
import type { RoleName } from "../types/role.js";

/**
 * 构建前序 step 的发现/进度摘要，注入到下一个 step 的 prompt。
 *
 * 采集规则：
 *  - found 信号 → 一律包含（信号本身就是"重要发现"的语义）
 *  - progress 信号 → 只保留 "完成"、"新建"、"修改"、"创建" 这类动作词
 *  - blocked/help 信号 → 不包含（这些是告警）
 *
 * 返回 null 表示没有可注入的内容。
 *
 * 【可观察测试点】返回的字符串里会带上 "[<workerId> <type>]" 前缀，
 *  以及行末的 "(总计 X 条)"。这两个特征可作为测试断言。
 *
 * 【O-5 时间过滤】若 runsStore 已有 worker（未来 Phase 5 会接入 runsStore.addWorker），
 * 取所有 worker 的最大 startedAt 作为 cutoff，过滤掉 cutoff 之后的信号。
 * v1 简化：runsStore 通常为空（chain 模式下 currentStep 还没 addWorker），
 * 此时 cutoff=0 不过滤，行为与重构前一致。
 *
 * @param dteam          dteam 上下文（signalBus / runsStore / runId）
 * @param currentStepIdx 当前 step 在 steps 数组中的下标（仅用于标注）
 * @param currentStepRole 当前 step 的角色（仅用于标注）
 */
export function buildHistoryContext(
  dteam: DteamContext,
  currentStepIdx: number,
  currentStepRole: RoleName,
): string | null {
  // 修 O-5：按 runsStore 中已 started 的 worker 时间过滤
  // v1 简化：runsStore 通常为空（chain 模式下 currentStep 还没 addWorker），
  // 此时 cutoff=0 不过滤，行为与重构前一致。
  const workers = dteam.runsStore.getAllWorkers(dteam.runId);
  const cutoffTime = workers.length > 0
    ? Math.max(...workers.map((w) => w.startedAt))
    : 0;

  const allSignals = dteam.signalBus.getHistory();

  const relevant = allSignals.filter((s) => {
    if (s.type !== "found" && s.type !== "progress") return false;
    // 修 O-5：过滤掉 cutoff 之后的信号（cutoffTime=0 时不过滤）
    if (cutoffTime > 0 && s.timestamp >= cutoffTime) return false;
    return true;
  });

  if (relevant.length === 0) return null;

  // 过滤 progress 动作词
  const interesting = relevant.filter((s) => {
    if (s.type === "found") return true;
    if (s.type === "progress") {
      const data = s.data as any;
      const summary = data.summary ?? data.action ?? "";
      // 只保留"完成/新建/修改/创建"类动作词
      return /完成|新建|修改|创建|delete|create|modify|done/i.test(summary);
    }
    return false;
  });

  if (interesting.length === 0) return null;

  // 按 workerId + type 分组
  const lines: string[] = [];
  lines.push(`## 前序发现（链式 step ${currentStepIdx}，角色 ${currentStepRole}）`);
  for (const s of interesting) {
    const data = s.data as any;
    const summary = data.summary ?? data.action ?? "";
    lines.push(`- [${s.workerId} ${s.type}] ${summary}`);
  }
  lines.push(`(总计 ${interesting.length} 条)`);
  return lines.join("\n");
}
