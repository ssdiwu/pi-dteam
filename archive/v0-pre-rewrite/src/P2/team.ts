/**
 * P2-细胞层：team 模式
 */

import { WorkerConfig, getRequiredOption, getOption } from "../P0/config.js";
import { WorkerStatus } from "../P0/status.js";
import { MemoryAdapter } from "../P0/memory.js";
import { mapWithConcurrencyLimit, withTimeout } from "../P0/concurrency.js";
import {
  createAdaptiveConcurrencyController,
  AdaptiveConcurrencyController,
} from "../P0/adaptiveConcurrency.js";
import { SignalBus } from "../P1/signalBus.js";
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
 *
 * @param parentWorkerId 可选：outer workerId（来自 wrapWorker）。
 *   存在时 emit 信号 workerId 使用 parentWorkerId 而非内部生成的 team-${ts}，
 *   以保证 P4 store 的主键与 wrapWorker 传入的 outer ID 一致（多 worker 不互相覆盖）。
 */
export async function runTeam(
  config: WorkerConfig,
  bus: SignalBus,
  memory: MemoryAdapter,
  executor: (role: string, task: string, style: string) => Promise<string>,
  parentWorkerId?: string,
): Promise<TeamResult> {
  const workers = getRequiredOption<WorkerConfig[]>(config.options, "workers");
  const rounds = getOption<number>(config.options, "rounds") || 5;
  const voting = getOption<boolean>(config.options, "voting") || false;
  const innerId = `team-${Date.now()}`;
  // 关键修复：emit workerId 用 parentWorkerId（outer）以避免 P4 store 主键冲突
  const workerId = parentWorkerId ?? innerId;

  // 获取并发控制参数
  const explicitConcurrency = getOption<number>(config.options, "concurrency");
  const concurrencyMode = getOption<string>(config.options, "concurrencyMode") || "adaptive";
  const minConcurrency = getOption<number>(config.options, "minConcurrency") || 1;
  const maxConcurrency = getOption<number>(config.options, "maxConcurrency") || 8;
  const timeoutMs = getOption<number>(config.options, "timeoutMs") || 300000; // 默认 5 分钟

  // 判断使用静态还是自适应并发
  const useAdaptive = concurrencyMode === "adaptive" && explicitConcurrency === undefined;
  let adaptiveController: AdaptiveConcurrencyController | undefined;

  if (useAdaptive) {
    adaptiveController = createAdaptiveConcurrencyController({
      minConcurrency,
      maxConcurrency,
    });
    adaptiveController.start();
  }

  try {
    bus.emit("progress", workerId, { status: "running" });

    // 获取当前并发度
    const getConcurrency = () => {
      if (explicitConcurrency !== undefined) {
        return explicitConcurrency;
      }
      if (adaptiveController) {
        return adaptiveController.getCurrentConcurrency();
      }
      return workers.length;
    };

    // 并行执行所有 worker（带并发控制）
    const results = await mapWithConcurrencyLimit(
      workers,
      getConcurrency(),
      async (worker, index) => {
        const startTime = Date.now();
        let result: SoloResult | ChainResult;

        // 为子 worker 发送一个带 parentWorkerId 的 progress 信号
        // P4 signal bridge 会从 bus 订阅这类信号并填入 store
        // （步骤 12 实现 P4 桥接）
        const childId = `${workerId}-${index}`;
        const childRole = (worker.options?.find((o) => o.type === "role")?.value as string) ?? "unknown";
        bus.emit("progress", childId, {
          status: "running",
          parentWorkerId: workerId,
          role: childRole,
          task: worker.task,
        });

        if (worker.type === "solo") {
          result = await withTimeout(
            runSolo(worker, bus, memory, executor, workerId),
            timeoutMs,
            `Worker ${worker.type} timed out after ${timeoutMs}ms`,
          );
        } else if (worker.type === "chain") {
          result = await withTimeout(
            runChain(worker, bus, memory, executor, workerId),
            timeoutMs,
            `Worker ${worker.type} timed out after ${timeoutMs}ms`,
          );
        } else {
          throw new Error(`Unsupported worker type: ${worker.type}`);
        }

        // 子 worker 结束
        bus.emit("progress", childId, {
          status: result.status,
          parentWorkerId: workerId,
          role: childRole,
        });

        // 报告任务完成延迟（用于自适应并发）
        if (adaptiveController) {
          adaptiveController.reportTaskComplete(Date.now() - startTime);
        }

        return result;
      },
    );

    // 停止自适应控制器
    if (adaptiveController) {
      adaptiveController.stop();
    }

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
    // 确保停止自适应控制器
    if (adaptiveController) {
      adaptiveController.stop();
    }

    bus.emit("blocked", workerId, { error: (error as Error).message });

    return {
      status: "failed",
      results: [],
      error: (error as Error).message,
    };
  }
}
