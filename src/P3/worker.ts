/**
 * P3-组织层：worker 编排器
 */

import { WorkerConfig } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { SignalBus } from "../P1/signalBus.js";
import { SharedMemory } from "../P1/sharedMemory.js";
import { runSolo, SoloResult } from "../P2/solo.js";
import { runChain, ChainResult } from "../P2/chain.js";
import { runTeam, TeamResult } from "../P2/team.js";

export type WorkerResult = SoloResult | ChainResult | TeamResult;

export interface OrchestratorResult {
  status: WorkerStatus;
  result: WorkerResult;
  conclusion?: string;
  error?: string;
}

/**
 * 执行 worker 编排
 */
export async function runWorker(
  config: WorkerConfig,
  bus: SignalBus,
  memory: SharedMemory,
  executor: (role: string, task: string, style: string) => Promise<string>,
): Promise<OrchestratorResult> {
  try {
    let result: WorkerResult;

    if (config.type === "solo") {
      result = await runSolo(config, bus, memory, executor);
    } else if (config.type === "chain") {
      result = await runChain(config, bus, memory, executor);
    } else if (config.type === "team") {
      result = await runTeam(config, bus, memory, executor);
    } else {
      throw new Error(`Unsupported worker type: ${config.type}`);
    }

    return {
      status: result.status,
      result,
      conclusion: result.conclusion,
      error: result.error,
    };
  } catch (error) {
    return {
      status: "failed",
      result: { status: "failed", error: (error as Error).message },
      error: (error as Error).message,
    };
  }
}
