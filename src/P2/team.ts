/**
 * P2-细胞层：team 模式
 */

import { WorkerConfig, getRequiredOption, getOption } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { SignalBus } from "../P1/signalBus.js";
import { SharedMemory } from "../P1/sharedMemory.js";
import { runSolo, SoloResult } from "./solo.js";
import { runChain, ChainResult } from "./chain.js";

export interface TeamResult {
  status: WorkerStatus;
  results: (SoloResult | ChainResult)[];
  conclusion?: string;
  error?: string;
}

/**
 * 执行 team 模式
 */
export async function runTeam(
  config: WorkerConfig,
  bus: SignalBus,
  memory: SharedMemory,
  executor: (role: string, task: string, style: string) => Promise<string>,
): Promise<TeamResult> {
  const workers = getRequiredOption<WorkerConfig[]>(config.options, "workers");
  const rounds = getOption<number>(config.options, "rounds") || 5;
  const voting = getOption<boolean>(config.options, "voting") || false;
  const workerId = `team-${Date.now()}`;

  try {
    bus.emit("progress", workerId, { status: "running" });

    // 并行执行所有 worker
    const promises = workers.map(async (worker) => {
      if (worker.type === "solo") {
        return runSolo(worker, bus, memory, executor);
      } else if (worker.type === "chain") {
        return runChain(worker, bus, memory, executor);
      } else {
        throw new Error(`Unsupported worker type: ${worker.type}`);
      }
    });

    const results = await Promise.all(promises);

    // 检查是否有失败的 worker
    const failed = results.find(r => r.status === "failed");
    if (failed) {
      bus.emit("blocked", workerId, { error: (failed as any).error });

      return {
        status: "failed",
        results,
        error: (failed as any).error,
      };
    }

    // 汇总结论
    const conclusions = results.map(r => r.conclusion).filter(Boolean);
    const conclusion = conclusions.join("\n");

    bus.emit("progress", workerId, { status: "done" });

    return {
      status: "done",
      results,
      conclusion,
    };
  } catch (error) {
    bus.emit("blocked", workerId, { error: (error as Error).message });

    return {
      status: "failed",
      results: [],
      error: (error as Error).message,
    };
  }
}
