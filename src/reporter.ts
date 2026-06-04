/**
 * dteam v1 — Reporter 抽象
 *
 * 把业务代码对 uiStore 的直接调用抽到 Reporter 接口后面。
 * 默认实现 defaultReporter 委托给 uiStore（行为完全不变）。
 *
 * 【重构方案】Phase 1 - D：解决 O-3 业务/UI 强耦合
 */

import { uiStore } from "./ui/index.js";

/** Worker 视图（业务用，不依赖 uiStore 内部类型） */
export interface WorkerView {
  id: string;
  parentId: string | null;
  title: string;
  status?: string;
  recentOutput?: string;
}

/** 信号视图（业务用） */
export interface SignalView {
  type: string;
  workerId: string;
  summary: string;
  timestamp: number;
}

/** 根的策略动作视图 */
export interface StrategyView {
  action: string;
  target: string;
  detail: string;
  timestamp: number;
}

/**
 * Reporter 接口 —— 业务代码应通过这个接口汇报状态，不直接调 uiStore。
 * 后续可替换为 CLI / JSON / Web UI 等不同实现。
 */
export interface Reporter {
  startRun(goal: string): void;
  addWorker(w: WorkerView): void;
  updateWorker(id: string, patch: { status?: string; recentOutput?: string }): void;
  addSignal(workerId: string, sig: SignalView): void;
  addStrategy(s: StrategyView): void;
  finishRun(): void;
  reset(): void;
}

/**
 * 默认实现：完全委托给 uiStore。
 * 行为与重构前一致（每个方法映射到对应的 uiStore 调用）。
 */
export const defaultReporter: Reporter = {
  startRun(goal) {
    uiStore.startRun(goal);
  },
  addWorker(w) {
    uiStore.addWorker({ id: w.id, parentId: w.parentId, title: w.title });
  },
  updateWorker(id, patch) {
    uiStore.updateWorker(id, patch);
  },
  addSignal(workerId, sig) {
    uiStore.addSignal(workerId, {
      type: sig.type,
      workerId: sig.workerId,
      summary: sig.summary,
      timestamp: sig.timestamp,
    });
  },
  addStrategy(s) {
    uiStore.addStrategy({
      action: s.action,
      target: s.target,
      detail: s.detail,
      timestamp: s.timestamp,
    });
  },
  finishRun() {
    uiStore.finishRun();
  },
  reset() {
    uiStore.reset();
  },
};
