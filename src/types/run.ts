/**
 * dteam v1 — Runs / Worker 类型
 *
 * WorkerRun 描述单个 worker 的生命周期；
 * ISignalBus / IRunsStore 是接口（避免循环依赖）。
 */

import type { RoleName } from "./role.js";
import type { Signal, SignalType } from "./signal.js";

export type WorkerRunStatus = "running" | "done" | "failed" | "blocked";

export interface WorkerRun {
  id: string;
  role: RoleName;
  task: string;
  input: string;
  output?: string;
  signals: Signal[];
  startedAt: number;
  finishedAt?: number;
  status: WorkerRunStatus;
}

// ═══ 信号总线 & Runs 存储（接口，避免循环依赖） ═══

export interface ISignalBus {
  emit(signal: Signal): Signal;
  getHistory(workerId?: string): Signal[];
  getByRun(runId: string): Signal[];
  on(type: SignalType, listener: (s: Signal) => void): () => void;
}

export interface IRunsStore {
  createRun(): string;
  addWorker(runId: string, worker: WorkerRun): void;
  getWorker(runId: string, workerId: string): WorkerRun | null;
  getAllWorkers(runId: string): WorkerRun[];
  appendSignal(runId: string, workerId: string, signal: Signal): void;
  finishWorker(runId: string, workerId: string, output: string, status: WorkerRunStatus): void;
}
