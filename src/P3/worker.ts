/**
 * P3-组织层：worker 编排器
 */

import { WorkerConfig } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { MemoryAdapter } from "../P0/memory.js";
import { SignalBus } from "../P1/signalBus.js";
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
 *
 * @param parentWorkerId 可选：outer workerId（来自 wrapWorker）。
 *   存在时透传给 runSolo/Chain/Team，让 P2 内部 emit 用 outer ID 替换内部生成的 solo/chain/team-${ts}，
 *   保证 P4 store 的主键与 wrapWorker 传入的 outer ID 一致（多 worker 不互相覆盖）。
 */
export async function runWorker(
  config: WorkerConfig,
  bus: SignalBus,
  memory: MemoryAdapter,
  executor: (role: string, task: string, style: string) => Promise<string>,
  parentWorkerId?: string,
): Promise<OrchestratorResult> {
  try {
    let result: WorkerResult;

    if (config.type === "solo") {
      result = await runSolo(config, bus, memory, executor, parentWorkerId);
    } else if (config.type === "chain") {
      result = await runChain(config, bus, memory, executor, parentWorkerId);
    } else if (config.type === "team") {
      result = await runTeam(config, bus, memory, executor, parentWorkerId);
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
