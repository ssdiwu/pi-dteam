/**
 * P2-细胞层：chain 模式
 */

import { WorkerConfig, getRequiredOption, getOption } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { SignalBus } from "../P1/signalBus.js";
import { SharedMemory } from "../P1/sharedMemory.js";
import { runSolo, SoloResult } from "./solo.js";
import { runTeam, TeamResult } from "./team.js";

export interface ChainResult {
  status: WorkerStatus;
  results: (SoloResult | TeamResult)[];
  conclusion?: string;
  error?: string;
}

/**
 * 执行 chain 模式
 */
export async function runChain(
  config: WorkerConfig,
  bus: SignalBus,
  memory: SharedMemory,
  executor: (role: string, task: string, style: string) => Promise<string>,
): Promise<ChainResult> {
  const steps = getRequiredOption<WorkerConfig[]>(config.options, "steps");
  const maxDepth = getOption<number>(config.options, "maxDepth") || 4;
  const workerId = `chain-${Date.now()}`;

  const results: (SoloResult | TeamResult)[] = [];

  try {
    bus.emit("progress", workerId, { status: "running" });

    for (const step of steps) {
      let result: SoloResult | TeamResult;
      if (step.type === "team") {
        result = await runTeam(step, bus, memory, executor);
      } else {
        result = await runSolo(step, bus, memory, executor);
      }
      results.push(result);

      if (result.status === "failed") {
        bus.emit("blocked", workerId, { error: result.error });

        return {
          status: "failed",
          results,
          error: result.error,
        };
      }
    }

    bus.emit("progress", workerId, { status: "done" });

    return {
      status: "done",
      results,
      conclusion: results.map(r => r.conclusion).join("\n"),
    };
  } catch (error) {
    bus.emit("blocked", workerId, { error: (error as Error).message });

    return {
      status: "failed",
      results,
      error: (error as Error).message,
    };
  }
}
