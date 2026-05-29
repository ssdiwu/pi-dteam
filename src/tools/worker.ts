/**
 * worker 工具实现
 *
 * 3个工具：worker.create/start/sendSignal
 */

import { WorkerConfig } from "../P0/config.js";
import { SignalBus } from "../P1/signalBus.js";
import { SharedMemory } from "../P1/sharedMemory.js";
import { runWorker } from "../P3/worker.js";

// ── 全局状态 ──────────────────────────────────────────────────

const workers = new Map<string, {
  config: WorkerConfig;
  bus: SignalBus;
  memory: SharedMemory;
  status: string;
}>();

const bus = new SignalBus();
const memory = new SharedMemory();

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * worker.create — 创建 worker 实例
 */
export async function workerCreate(
  ctx: { cwd: string },
  params: { config: WorkerConfig },
): Promise<{ content: string }> {
  const { config } = params;
  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  workers.set(workerId, {
    config,
    bus,
    memory,
    status: "pending",
  });

  return {
    content: JSON.stringify({
      workerId,
      config,
      message: `Worker created: ${workerId}`,
    }),
  };
}

/**
 * worker.start — 启动 worker 执行
 */
export async function workerStart(
  ctx: { cwd: string },
  params: { workerId: string },
): Promise<{ content: string }> {
  const { workerId } = params;
  const worker = workers.get(workerId);

  if (!worker) {
    return {
      content: JSON.stringify({
        error: `Worker not found: ${workerId}`,
      }),
    };
  }

  // 默认执行器：模拟执行
  const executor = async (role: string, task: string, style: string) => {
    return `Executed ${role} with style ${style}: ${task}`;
  };

  try {
    worker.status = "running";
    const result = await runWorker(worker.config, worker.bus, worker.memory, executor);
    worker.status = "done";

    return {
      content: JSON.stringify({
        workerId,
        result,
        message: `Worker completed: ${workerId}`,
      }),
    };
  } catch (error) {
    worker.status = "failed";

    return {
      content: JSON.stringify({
        workerId,
        error: (error as Error).message,
        message: `Worker failed: ${workerId}`,
      }),
    };
  }
}

/**
 * worker.sendSignal — 发送信号到 worker
 */
export async function workerSendSignal(
  ctx: { cwd: string },
  params: { workerId: string; signalType: string; data?: Record<string, unknown> },
): Promise<{ content: string }> {
  const { workerId, signalType, data = {} } = params;
  const worker = workers.get(workerId);

  if (!worker) {
    return {
      content: JSON.stringify({
        error: `Worker not found: ${workerId}`,
      }),
    };
  }

  const signal = worker.bus.emit(signalType as any, workerId, data);

  return {
    content: JSON.stringify({
      workerId,
      signal,
      message: `Signal sent: ${signalType}`,
    }),
  };
}
