/**
 * dteam v1 — Runs 存储（内存版）
 *
 * 每次派生 worker 对应一个 WorkerRun，挂在一个 runId 下。
 * 不落盘，单次 dteam 调用结束后由 GC 回收。
 */

import type { WorkerRun, WorkerRunStatus, Signal } from "../tools.js";

export class RunsStore {
  private runs = new Map<string, Map<string, WorkerRun>>();

  createRun(): string {
    const runId = `run-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    this.runs.set(runId, new Map());
    return runId;
  }

  addWorker(runId: string, worker: WorkerRun): void {
    const workers = this.runs.get(runId);
    if (!workers) throw new Error(`RunsStore: run ${runId} not found`);
    workers.set(worker.id, worker);
  }

  getWorker(runId: string, workerId: string): WorkerRun | null {
    return this.runs.get(runId)?.get(workerId) ?? null;
  }

  getAllWorkers(runId: string): WorkerRun[] {
    const workers = this.runs.get(runId);
    if (!workers) return [];
    return Array.from(workers.values()).map(w => ({ ...w, signals: [...w.signals] }));
  }

  appendSignal(runId: string, workerId: string, signal: Signal): void {
    const worker = this.runs.get(runId)?.get(workerId);
    if (!worker) throw new Error(`RunsStore: worker ${workerId} not found in run ${runId}`);
    worker.signals.push(signal);
  }

  finishWorker(runId: string, workerId: string, output: string, status: WorkerRunStatus): void {
    const worker = this.runs.get(runId)?.get(workerId);
    if (!worker) return;
    worker.output = output;
    worker.status = status;
    worker.finishedAt = Date.now();
  }
}
