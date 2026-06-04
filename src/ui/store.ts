/**
 * ui/store.ts — dteam UI 状态管理
 *
 * 维护一次 run 的整体状态以及所有 worker 的生命周期。
 * 对外暴露只读快照，确保 UI 层无法意外突变内部状态。
 */

// ---------------------------------------------------------------------------
// 类型
// ---------------------------------------------------------------------------

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
}

/** 整个 run 的 UI 状态快照 */
export interface UIState {
  goal: string;
  workers: UIWorkerState[];
  startedAt: number;
  finishedAt: number | null;
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
  };

  startRun(goal: string): void {
    this.state = {
      goal,
      workers: [],
      startedAt: Date.now(),
      finishedAt: null,
    };
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
      if ((patch.status === "done" || patch.status === "error") && worker.finishedAt === null) {
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

  finishRun(): void {
    this.state.finishedAt = Date.now();
  }

  getState(): UIState {
    return deepClone(this.state);
  }

  getRunningWorkers(): UIWorkerState[] {
    return deepClone(this.state.workers.filter((w) => w.status === "running"));
  }
}

export const uiStore = new UIStore();
