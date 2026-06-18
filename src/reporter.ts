/**
 * dteam 0.6.0 — Reporter 抽象（最小 no-op）
 *
 * 0.6.0 Orchestrator Loop 自带 summonTrail/signalSnapshot，不再依赖 0.5.0 的
 * uiStore + setPlan/setScheduling 那套展示层。Reporter 降级为 no-op 占位，
 * 保留接口形状以兼容 index.ts 的 ctx.reporter 透传；后续 UI 重做时再实现。
 *
 * 0.5.0 的 uiStore/PlanView/SchedulingPlan 引用已随二维编排类型一并清除。
 */

/** Worker 视图（保留最小形状，供未来 UI 实现用） */
export interface WorkerView {
  id: string;
  parentId: string | null;
  title: string;
  status?: string;
  recentOutput?: string;
  files?: string[];
}

/** 信号视图 */
export interface SignalView {
  type: string;
  workerId: string;
  summary: string;
  timestamp: number;
}

/**
 * Reporter 接口 —— 0.6.0 暂为 no-op；Orchestrator Loop 不经此接口汇报。
 * 保留形状以兼容 index.ts 透传 ctx.reporter。
 */
export interface Reporter {
  startRun(goal: string): void;
  addWorker(w: WorkerView): void;
  updateWorker(id: string, patch: { status?: string; recentOutput?: string }): void;
  addSignal(workerId: string, sig: SignalView): void;
  finishRun(): void;
  reset(): void;
}

/** 默认 no-op 实现 */
export const defaultReporter: Reporter = {
  startRun() {},
  addWorker() {},
  updateWorker() {},
  addSignal() {},
  finishRun() {},
  reset() {},
};
