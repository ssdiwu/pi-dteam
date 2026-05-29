/**
 * P1-分子层：后台worker
 *
 * 后台执行worker，不阻塞用户交互
 */

import { WorkerConfig } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { SignalBus } from "./signalBus.js";
import { EnhancedSharedMemory } from "./enhancedSharedMemory.js";
import { runWorker } from "../P3/worker.js";

// ── 类型定义 ──────────────────────────────────────────────

export interface BackgroundWorkerOptions {
  onProgress?: (workerId: string, status: WorkerStatus, task: string) => void;
  onHelp?: (workerId: string, question: string) => void;
  onComplete?: (workerId: string, result: any) => void;
  onError?: (workerId: string, error: string) => void;
}

export interface BackgroundWorker {
  id: string;
  status: WorkerStatus;
  start(): Promise<void>;
  cancel(): void;
  respond(workerId: string, answer: string): void;
}

// ── 后台worker实现 ──────────────────────────────────────────

class BackgroundWorkerImpl implements BackgroundWorker {
  readonly id: string;
  status: WorkerStatus = "pending";
  
  private config: WorkerConfig;
  private bus: SignalBus;
  private memory: EnhancedSharedMemory;
  private options: BackgroundWorkerOptions;
  private abortController: AbortController;
  private helpCallbacks: Map<string, (answer: string) => void> = new Map();

  constructor(
    id: string,
    config: WorkerConfig,
    bus: SignalBus,
    memory: EnhancedSharedMemory,
    options: BackgroundWorkerOptions,
  ) {
    this.id = id;
    this.config = config;
    this.bus = bus;
    this.memory = memory;
    this.options = options;
    this.abortController = new AbortController();

    // 监听信号
    this.setupSignalListeners();
  }

  private setupSignalListeners() {
    // 监听进度信号
    this.bus.on("progress", (signal) => {
      if (this.options.onProgress) {
        this.options.onProgress(
          signal.workerId,
          signal.data.status as WorkerStatus,
          signal.data.task as string,
        );
      }
    });

    // 监听help信号
    this.bus.on("help", (signal) => {
      if (this.options.onHelp) {
        this.options.onHelp(
          signal.workerId,
          signal.data.question as string,
        );
      }
    });

    // 监听blocked信号
    this.bus.on("blocked", (signal) => {
      if (this.options.onError) {
        this.options.onError(
          signal.workerId,
          signal.data.error as string,
        );
      }
    });
  }

  async start(): Promise<void> {
    this.status = "running";

    // 默认执行器
    const executor = async (role: string, task: string, style: string) => {
      return `Executed ${role} with style ${style}: ${task}`;
    };

    try {
      const result = await runWorker(
        this.config,
        this.bus,
        this.memory,
        executor,
      );

      this.status = result.status;

      if (this.options.onComplete) {
        this.options.onComplete(this.id, result);
      }
    } catch (error) {
      this.status = "failed";

      if (this.options.onError) {
        this.options.onError(this.id, (error as Error).message);
      }
    }
  }

  cancel(): void {
    this.abortController.abort();
    this.status = "failed";
  }

  respond(workerId: string, answer: string): void {
    const callback = this.helpCallbacks.get(workerId);
    if (callback) {
      callback(answer);
      this.helpCallbacks.delete(workerId);
    }
  }
}

// ── 工厂函数 ──────────────────────────────────────────────

let workerCounter = 0;

/**
 * 创建后台worker
 */
export function createBackgroundWorker(
  config: WorkerConfig,
  bus: SignalBus,
  memory: EnhancedSharedMemory,
  options: BackgroundWorkerOptions = {},
): BackgroundWorker {
  const id = `bg-worker-${Date.now()}-${++workerCounter}`;
  return new BackgroundWorkerImpl(id, config, bus, memory, options);
}
