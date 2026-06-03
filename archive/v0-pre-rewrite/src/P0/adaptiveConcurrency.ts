/**
 * P0-原子层：自适应并发控制器
 *
 * 基于系统 CPU/内存采样 + 任务吞吐反馈，动态调节并发度。
 * 状态机：coldStart → exploring → steady → overload
 */

import * as os from "os";

// ──────────────────────────────────────────────────────────────────────────────
// 类型
// ──────────────────────────────────────────────────────────────────────────────

export type ConcurrencyState = "coldStart" | "exploring" | "steady" | "overload";

export interface SystemSample {
  cpuUsage: number;    // 0-100
  freeMemoryMB: number;
  timestamp: number;
}

export interface AdaptiveConcurrencyConfig {
  minConcurrency?: number;   // 默认 1
  maxConcurrency?: number;   // 默认 8
  sampleIntervalMs?: number; // 默认 5000
  overloadCpuThreshold?: number;   // 默认 85
  overloadMemoryThresholdMB?: number; // 默认 500
  stableThreshold?: number; // 默认 3（连续 N 次无显著变化）
}

export interface AdaptiveConcurrencyController {
  getCurrentConcurrency: () => number;
  getState: () => ConcurrencyState;
  start: () => void;
  stop: () => void;
  reportTaskComplete: (latencyMs: number) => void;
  forceState: (state: ConcurrencyState) => void;
  getSamples: () => SystemSample[];
}

// ──────────────────────────────────────────────────────────────────────────────
// 采样器
// ──────────────────────────────────────────────────────────────────────────────

/** 获取系统资源样本 */
export function sampleSystem(): SystemSample {
  const cpus = os.cpus();
  const cpuUsage = calculateCpuUsage(cpus);
  const freeMemoryMB = os.freemem() / (1024 * 1024);

  return {
    cpuUsage,
    freeMemoryMB,
    timestamp: Date.now(),
  };
}

function calculateCpuUsage(cpus: os.CpuInfo[]): number {
  let totalIdle = 0;
  let totalTick = 0;

  for (const cpu of cpus) {
    for (const type of Object.keys(cpu.times) as Array<keyof typeof cpu.times>) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  }

  return totalTick > 0 ? Math.round(((totalTick - totalIdle) / totalTick) * 100) : 0;
}

// ──────────────────────────────────────────────────────────────────────────────
// 状态机
// ──────────────────────────────────────────────────────────────────────────────

interface StateMachineContext {
  concurrency: number;
  stableCount: number;
  samples: SystemSample[];
  recentLatencies: number[];
  minConcurrency: number;
  maxConcurrency: number;
  overloadCpuThreshold: number;
  overloadMemoryThresholdMB: number;
  stableThreshold: number;
}

/** 状态转移函数 */
export function transitionState(
  state: ConcurrencyState,
  sample: SystemSample,
  ctx: StateMachineContext,
): { state: ConcurrencyState; concurrencyDelta: number } {
  const { overloadCpuThreshold, overloadMemoryThresholdMB, stableThreshold } = ctx;

  switch (state) {
    case "coldStart":
      // 冷启动后首次采样完成，进入探索期
      return { state: "exploring", concurrencyDelta: 0 };

    case "exploring": {
      // 检查是否过载
      if (isOverloaded(sample, overloadCpuThreshold, overloadMemoryThresholdMB)) {
        return { state: "overload", concurrencyDelta: -1 };
      }

      // 检查吞吐是否稳定（通过延迟变化判断）
      const latencyStable = isLatencyStable(ctx.recentLatencies, stableThreshold);
      if (latencyStable && ctx.stableCount >= stableThreshold) {
        return { state: "steady", concurrencyDelta: 0 };
      }

      // 探索期：逐步递增
      return { state: "exploring", concurrencyDelta: 1 };
    }

    case "steady": {
      // 检查是否过载
      if (isOverloaded(sample, overloadCpuThreshold, overloadMemoryThresholdMB)) {
        return { state: "overload", concurrencyDelta: -1 };
      }

      // 稳态微调：±1
      const delta = sample.cpuUsage > 70 ? -1 : sample.cpuUsage < 30 ? 1 : 0;
      return { state: "steady", concurrencyDelta: delta };
    }

    case "overload": {
      // 检查是否恢复
      if (
        sample.cpuUsage < 70 &&
        sample.freeMemoryMB > 1000
      ) {
        return { state: "steady", concurrencyDelta: 0 };
      }

      // 仍然过载，继续降级
      return { state: "overload", concurrencyDelta: -1 };
    }

    default:
      return { state: "coldStart", concurrencyDelta: 0 };
  }
}

function isOverloaded(
  sample: SystemSample,
  cpuThreshold: number,
  memoryThresholdMB: number,
): boolean {
  return sample.cpuUsage > cpuThreshold || sample.freeMemoryMB < memoryThresholdMB;
}

function isLatencyStable(latencies: number[], threshold: number): boolean {
  if (latencies.length < threshold) return false;
  const recent = latencies.slice(-threshold);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const maxDeviation = Math.max(...recent.map(l => Math.abs(l - avg)));
  return maxDeviation / avg < 0.2; // 20% 以内视为稳定
}

// ──────────────────────────────────────────────────────────────────────────────
// 控制器
// ──────────────────────────────────────────────────────────────────────────────

export function createAdaptiveConcurrencyController(
  config: AdaptiveConcurrencyConfig = {},
): AdaptiveConcurrencyController {
  const minConcurrency = config.minConcurrency ?? 1;
  const maxConcurrency = config.maxConcurrency ?? 8;
  const sampleIntervalMs = config.sampleIntervalMs ?? 5000;
  const overloadCpuThreshold = config.overloadCpuThreshold ?? 85;
  const overloadMemoryThresholdMB = config.overloadMemoryThresholdMB ?? 500;
  const stableThreshold = config.stableThreshold ?? 3;

  let state: ConcurrencyState = "coldStart";
  let concurrency = minConcurrency;
  let stableCount = 0;
  let sampleTimer: ReturnType<typeof setInterval> | null = null;
  const samples: SystemSample[] = [];
  const recentLatencies: number[] = [];

  const ctx: StateMachineContext = {
    get concurrency() { return concurrency; },
    get stableCount() { return stableCount; },
    get samples() { return samples; },
    get recentLatencies() { return recentLatencies; },
    minConcurrency,
    maxConcurrency,
    overloadCpuThreshold,
    overloadMemoryThresholdMB,
    stableThreshold,
  };

  function tick() {
    const sample = sampleSystem();
    samples.push(sample);
    if (samples.length > 100) samples.shift();

    const result = transitionState(state, sample, ctx);

    // 更新状态
    if (result.state !== state) {
      stableCount = 0;
    } else {
      stableCount++;
    }
    state = result.state;

    // 应用并发度变化（带边界保护）
    concurrency = Math.max(minConcurrency, Math.min(maxConcurrency, concurrency + result.concurrencyDelta));
  }

  return {
    getCurrentConcurrency: () => concurrency,
    getState: () => state,

    start: () => {
      if (sampleTimer) return;
      // 首次采样立即执行
      tick();
      sampleTimer = setInterval(tick, sampleIntervalMs);
      // 允许 timer 不阻止进程退出
      if (sampleTimer && typeof sampleTimer.unref === "function") {
        sampleTimer.unref();
      }
    },

    stop: () => {
      if (sampleTimer) {
        clearInterval(sampleTimer);
        sampleTimer = null;
      }
    },

    reportTaskComplete: (latencyMs: number) => {
      recentLatencies.push(latencyMs);
      if (recentLatencies.length > 20) recentLatencies.shift();
    },

    forceState: (newState: ConcurrencyState) => {
      state = newState;
      stableCount = 0;
    },

    getSamples: () => [...samples],
  };
}
