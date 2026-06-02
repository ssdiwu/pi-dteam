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
 *
 * @param parentWorkerId 可选：outer workerId（来自 wrapWorker）。
 *   存在时 emit 信号 workerId 使用 parentWorkerId 而非内部生成的 chain-${ts}，
 *   以保证 P4 store 的主键与 wrapWorker 传入的 outer ID 一致（多 worker 不互相覆盖）。
 */
export async function runChain(
  config: WorkerConfig,
  bus: SignalBus,
  memory: MemoryAdapter,
  executor: (role: string, task: string, style: string) => Promise<string>,
  parentWorkerId?: string,
): Promise<ChainResult> {
  const steps = getRequiredOption<WorkerConfig[]>(config.options, "steps");
  const innerId = `chain-${Date.now()}`;
  // 关键修复：emit workerId 用 parentWorkerId（outer）以避免 P4 store 主键冲突
  const workerId = parentWorkerId ?? innerId;
  const results: (SoloResult | TeamResult)[] = [];

  try {
    bus.emit("progress", workerId, { status: "running" });
    const failed = await executeChainSteps(steps, results, bus, memory, executor, workerId, parentWorkerId);
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
  parentChainId: string,
  outerParentWorkerId?: string,
): Promise<SoloResult | TeamResult | undefined> {
  let previousConclusion = "";
  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    const effectiveStep = previousConclusion ? withPreviousOutput(step, previousConclusion) : step;

    // chain step 发信号：parentWorkerId = chainId, chainIndex = i+1, chainTotal = steps.length
    // P4 signal bridge 会订阅并填入 store
    const stepId = `${parentChainId}-${i + 1}`;
    const stepRole = (step.options?.find((o) => o.type === "role")?.value as string) ?? "unknown";
    bus.emit("progress", stepId, {
      status: "running",
      parentWorkerId: parentChainId,
      role: stepRole,
      task: step.task,
      chainIndex: i + 1,
      chainTotal: steps.length,
      isChainStep: true,
    });

    // 关键修复：透传 outerParentWorkerId 给子 step 的 runSolo/Team，
    // 让嵌套 step 的 emit workerId 也用 outer ID。
    const result = await runChainStep(effectiveStep, bus, memory, executor, outerParentWorkerId);
    results.push(result);

    bus.emit("progress", stepId, {
      status: result.status,
      parentWorkerId: parentChainId,
      role: stepRole,
      chainIndex: i + 1,
      chainTotal: steps.length,
      isChainStep: true,
    });

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
  parentWorkerId?: string,
): Promise<SoloResult | TeamResult> {
  return step.type === "team"
    ? runTeam(step, bus, memory, executor, parentWorkerId)
    : runSolo(step, bus, memory, executor, parentWorkerId);
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
