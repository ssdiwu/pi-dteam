/**
 * P2-细胞层：solo 模式
 */

import { WorkerConfig, getRequiredOption } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { SignalBus } from "../P1/signalBus.js";
import { SharedMemory } from "../P1/sharedMemory.js";

export interface SoloResult {
  status: WorkerStatus;
  conclusion?: string;
  error?: string;
}

/**
 * 执行 solo 模式
 */
export async function runSolo(
  config: WorkerConfig,
  bus: SignalBus,
  memory: SharedMemory,
  executor: (role: string, task: string, style: string) => Promise<string>,
): Promise<SoloResult> {
  const role = getRequiredOption<string>(config.options, "role");
  const workerId = `solo-${Date.now()}`;

  try {
    bus.emit("progress", workerId, { status: "running" });

    const conclusion = await executor(role, config.task, config.style);

    bus.emit("progress", workerId, { status: "done" });

    return {
      status: "done",
      conclusion,
    };
  } catch (error) {
    bus.emit("blocked", workerId, { error: (error as Error).message });

    return {
      status: "failed",
      error: (error as Error).message,
    };
  }
}
