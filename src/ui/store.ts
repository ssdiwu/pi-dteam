/**
 * ui/store.ts — dteam UI 状态管理
 *
 * 维护一次 run 的整体状态以及所有 worker 的生命周期。
 * 对外暴露只读快照，确保 UI 层无法意外突变内部状态。
 */

import type { ExecMode, SchedulingPlan } from "../tools.js";

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

/** 信号的 UI 表示 */
export interface UISignal {
  type: string;
  workerId: string;
  summary: string;
  timestamp: number;
}

/** 根的策略下发记录 */
export interface UIStrategy {
  action: string;
  target: string;
  detail: string;
  timestamp: number;
}

/** 单个 worker 的 UI 状态快照 */
export interface UIWorkerState {
  id: string;
  parentId: string | null;
  title: string;
  status: string;
  startedAt: number | null;
  finishedAt: number | null;
  recentOutput: string[];
  currentTool: string | null;
  /** 该 worker 发过的信号 */
  signals: UISignal[];
}

/** 整个 run 的 UI 状态快照 */
export interface UIState {
  goal: string;
  mode?: ExecMode;
  planReason?: string;
  workers: UIWorkerState[];
  startedAt: number;
  finishedAt: number | null;
  /** 0.5.0：preflight 后的 batch 调度计划 */
  scheduling?: SchedulingPlan;
  /** 根的策略下发记录 */
  strategies: UIStrategy[];
}

// ---------------------------------------------------------------------------
// UIStore 单例
// ---------------------------------------------------------------------------

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

export class UIStore {
  private state: UIState = {
    goal: "",
    workers: [],
    startedAt: 0,
    finishedAt: null,
    strategies: [],
  };

  startRun(goal: string): void {
    this.state = {
      goal,
      workers: [],
      startedAt: Date.now(),
      finishedAt: null,
      strategies: [],
    };
  }

  setPlan(plan: { mode: ExecMode; reason: string }): void {
    this.state.mode = plan.mode;
    this.state.planReason = plan.reason;
  }

  setScheduling(scheduling: SchedulingPlan): void {
    this.state.scheduling = scheduling;
  }

  addWorker(worker: { id: string; parentId: string | null; title: string }): void {
    this.state.workers.push({
      id: worker.id,
      parentId: worker.parentId,
      title: worker.title,
      status: "idle",
      startedAt: null,
      finishedAt: null,
      recentOutput: [],
      currentTool: null,
      signals: [],
    });
  }

  updateWorker(
    id: string,
    patch: { status?: string; currentTool?: string | null; recentOutput?: string },
  ): void {
    const worker = this.state.workers.find((w) => w.id === id);
    if (!worker) return;

    if (patch.status !== undefined) {
      worker.status = patch.status;
      if (patch.status === "running" && worker.startedAt === null) {
        worker.startedAt = Date.now();
      }
      if ((patch.status === "done" || patch.status === "failed" || patch.status === "error") && worker.finishedAt === null) {
        worker.finishedAt = Date.now();
      }
    }

    if (patch.currentTool !== undefined) {
      worker.currentTool = patch.currentTool;
    }

    if (patch.recentOutput !== undefined) {
      worker.recentOutput.push(patch.recentOutput);
      if (worker.recentOutput.length > 50) {
        worker.recentOutput = worker.recentOutput.slice(-50);
      }
    }
  }

  /** 记录 worker 发的信号 */
  addSignal(workerId: string, signal: UISignal): void {
    const worker = this.state.workers.find((w) => w.id === workerId);
    if (!worker) return;
    worker.signals.push(signal);
    if (worker.signals.length > 100) {
      worker.signals = worker.signals.slice(-100);
    }
  }

  /** 记录根的策略下发 */
  addStrategy(strategy: UIStrategy): void {
    this.state.strategies.push(strategy);
    if (this.state.strategies.length > 50) {
      this.state.strategies = this.state.strategies.slice(-50);
    }
  }

  finishRun(): void {
    this.state.finishedAt = Date.now();
  }

  /** 重置所有状态（run 完成后） */
  reset(): void {
    this.state = {
      goal: "",
      workers: [],
      startedAt: 0,
      finishedAt: null,
      strategies: [],
    };
  }

  getState(): UIState {
    return deepClone(this.state);
  }

  getRunningWorkers(): UIWorkerState[] {
    return deepClone(this.state.workers.filter((w) => w.status === "running"));
  }
}

export const uiStore = new UIStore();
