/**
 * P2-细胞层：solo 模式
 */

import { WorkerConfig, getRequiredOption } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { MemoryAdapter } from "../P0/memory.js";
import { SignalBus } from "../P1/signalBus.js";

export interface SoloResult {
  status: WorkerStatus;
  conclusion?: string;
  error?: string;
}

/**
 * 执行 solo 模式
 *
 * @param parentWorkerId 可选：outer workerId（来自 wrapWorker）。
 *   存在时 emit 信号 workerId 使用 parentWorkerId 而非内部生成的 solo-${ts}，
 *   以保证 P4 store 的主键与 wrapWorker 传入的 outer ID 一致（多 worker 不互相覆盖）。
 */
export async function runSolo(
  config: WorkerConfig,
  bus: SignalBus,
  memory: MemoryAdapter,
  executor: (role: string, task: string, style: string) => Promise<string>,
  parentWorkerId?: string,
): Promise<SoloResult> {
  const role = getRequiredOption<string>(config.options, "role");
  const innerId = `solo-${Date.now()}`;
  // 关键修复：emit workerId 用 parentWorkerId（outer）以避免 P4 store 主键冲突
  const workerId = parentWorkerId ?? innerId;

  try {
    bus.emit("progress", workerId, { status: "running" });

    const conclusion = await executor(role, config.task, config.style);

    bus.emit("progress", workerId, { status: "done" });

    return {
      status: "done",
      conclusion,
    };
  } catch (error) {
    const err = error as Error & { signalData?: Record<string, unknown> };
    bus.emit("blocked", workerId, err.signalData ?? { error: err.message });

    return {
      status: "failed",
      error: err.message,
    };
  }
}
