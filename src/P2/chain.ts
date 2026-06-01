/**
 * P2-细胞层：chain 模式
 */

import { WorkerConfig, getRequiredOption } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { MemoryAdapter } from "../P0/memory.js";
import { SignalBus } from "../P1/signalBus.js";
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
  memory: MemoryAdapter,
  executor: (role: string, task: string, style: string) => Promise<string>,
): Promise<ChainResult> {
  const steps = getRequiredOption<WorkerConfig[]>(config.options, "steps");
  const workerId = `chain-${Date.now()}`;
  const results: (SoloResult | TeamResult)[] = [];

  try {
    bus.emit("progress", workerId, { status: "running" });
    const failed = await executeChainSteps(steps, results, bus, memory, executor);
    if (failed) {
      bus.emit("blocked", workerId, { error: failed.error });
      return { status: "failed", results, error: failed.error };
    }

    bus.emit("progress", workerId, { status: "done" });
    return { status: "done", results, conclusion: results.map(r => r.conclusion).join("\n") };
  } catch (error) {
    bus.emit("blocked", workerId, { error: (error as Error).message });
    return { status: "failed", results, error: (error as Error).message };
  }
}

async function executeChainSteps(
  steps: WorkerConfig[],
  results: (SoloResult | TeamResult)[],
  bus: SignalBus,
  memory: MemoryAdapter,
  executor: (role: string, task: string, style: string) => Promise<string>,
): Promise<SoloResult | TeamResult | undefined> {
  let previousConclusion = "";
  for (const step of steps) {
    const effectiveStep = previousConclusion ? withPreviousOutput(step, previousConclusion) : step;
    const result = await runChainStep(effectiveStep, bus, memory, executor);
    results.push(result);
    if (result.status === "failed") return result;
    previousConclusion = result.conclusion || previousConclusion;
  }
  return undefined;
}

async function runChainStep(
  step: WorkerConfig,
  bus: SignalBus,
  memory: MemoryAdapter,
  executor: (role: string, task: string, style: string) => Promise<string>,
): Promise<SoloResult | TeamResult> {
  return step.type === "team"
    ? runTeam(step, bus, memory, executor)
    : runSolo(step, bus, memory, executor);
}

function withPreviousOutput(config: WorkerConfig, output: string): WorkerConfig {
  return {
    ...config,
    task: `${config.task}\n\n## Previous step output\n${output}`,
    options: config.options?.map((option) => {
      if (option.type === "workers") {
        return { ...option, value: option.value.map((w) => withPreviousOutput(w, output)) };
      }
      if (option.type === "steps") {
        return { ...option, value: option.value.map((s) => withPreviousOutput(s, output)) };
      }
      return option;
    }),
  };
}
