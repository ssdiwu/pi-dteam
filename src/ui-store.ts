/**
 * ui-store.ts — dteam v1 全局 UI 状态管理模块
 *
 * 为 TUI widget 和面板提供实时数据。维护一次 run 的整体状态以及
 * 所有 worker 的生命周期（创建、更新、完成），对外暴露只读快照，
 * 确保 UI 层无法意外突变内部状态。
 *
 * 无外部依赖，纯 TypeScript 实现。
 */

// ---------------------------------------------------------------------------
// 类型定义
// ---------------------------------------------------------------------------

/** 单个 worker 的 UI 状态快照 */
export interface UIWorkerState {
  /** worker 唯一标识 */
  id: string;
  /** 父 worker 的 id，顶层为 null */
  parentId: string | null;
  /** 人类可读的 worker 描述 / 标题 */
  title: string;
  /** 当前状态，例如 "running" | "done" | "error" | "idle" */
  status: string;
  /** worker 开始运行的 Unix 时间戳（ms），未开始则为 null */
  startedAt: number | null;
  /** worker 结束运行的 Unix 时间戳（ms），未结束则为 null */
  finishedAt: number | null;
  /** 最近几行输出文本（滚动窗口） */
  recentOutput: string[];
  /** 当前正在使用的工具名称，无则 null */
  currentTool: string | null;
}

/** 整个 run 的 UI 状态快照 */
export interface UIState {
  /** 本次 run 的目标描述 */
  goal: string;
  /** 所有 worker 的状态列表 */
  workers: UIWorkerState[];
  /** run 开始的 Unix 时间戳（ms） */
  startedAt: number;
  /** run 结束的 Unix 时间戳（ms），未结束则为 null */
  finishedAt: number | null;
}

// ---------------------------------------------------------------------------
// 深拷贝工具
// ---------------------------------------------------------------------------

function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

// ---------------------------------------------------------------------------
// UIStore 单例类
// ---------------------------------------------------------------------------

export class UIStore {
  // ---- 内部状态 ----
  private state: UIState = UIStore.createInitialState();

  // ---- 单例控制 ----
  private static _instance: UIStore | null = null;

  constructor() {
    // 单例模式：如果已存在实例则返回已有实例
    if (UIStore._instance) {
      return UIStore._instance;
    }
    UIStore._instance = this;
  }

  // ---- 工厂方法 ----

  private static createInitialState(): UIState {
    return {
      goal: "",
      workers: [],
      startedAt: 0,
      finishedAt: null,
    };
  }

  // ---- 公开 API ----

  /**
   * 开始一个新的 run，重置所有状态。
   * @param goal 本次 run 的目标描述
   */
  startRun(goal: string): void {
    this.state = {
      goal,
      workers: [],
      startedAt: Date.now(),
      finishedAt: null,
    };
  }

  /**
   * 添加一个 worker 到当前 run。
   * @param worker 包含 id、parentId、title 的 worker 描述
   */
  addWorker(worker: { id: string; parentId: string | null; title: string }): void {
    const workerState: UIWorkerState = {
      id: worker.id,
      parentId: worker.parentId,
      title: worker.title,
      status: "idle",
      startedAt: null,
      finishedAt: null,
      recentOutput: [],
      currentTool: null,
    };
    this.state.workers.push(workerState);
  }

  /**
   * 更新指定 worker 的状态。
   * @param id worker 唯一标识
   * @param patch 需要更新的字段
   */
  updateWorker(
    id: string,
    patch: { status?: string; currentTool?: string | null; recentOutput?: string }
  ): void {
    const worker = this.state.workers.find((w) => w.id === id);
    if (!worker) {
      return;
    }

    if (patch.status !== undefined) {
      worker.status = patch.status;
      // 首次设置为 running 时记录 startedAt
      if (patch.status === "running" && worker.startedAt === null) {
        worker.startedAt = Date.now();
      }
      // 标记为终态时记录 finishedAt
      if (
        (patch.status === "done" || patch.status === "error") &&
        worker.finishedAt === null
      ) {
        worker.finishedAt = Date.now();
      }
    }

    if (patch.currentTool !== undefined) {
      worker.currentTool = patch.currentTool;
    }

    if (patch.recentOutput !== undefined) {
      worker.recentOutput.push(patch.recentOutput);
      // 保持滚动窗口，最多保留 50 条
      if (worker.recentOutput.length > 50) {
        worker.recentOutput = worker.recentOutput.slice(-50);
      }
    }
  }

  /**
   * 标记当前 run 结束。
   */
  finishRun(): void {
    this.state.finishedAt = Date.now();
  }

  /**
   * 获取当前完整状态的深拷贝。
   * UI 层可安全持有并渲染此快照，无需担心突变。
   */
  getState(): UIState {
    return deepClone(this.state);
  }

  /**
   * 获取所有正在运行的 worker（status === "running"）的深拷贝列表。
   */
  getRunningWorkers(): UIWorkerState[] {
    return deepClone(
      this.state.workers.filter((w) => w.status === "running")
    );
  }
}

// ---------------------------------------------------------------------------
// 全局单例导出
// ---------------------------------------------------------------------------

export const uiStore = new UIStore();
