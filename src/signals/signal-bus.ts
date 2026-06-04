/**
 * dteam v1 — 信号总线（内存版）
 *
 * 进程内通信中枢：worker 通过 emit 上报信号，主编排器通过 getHistory/on 消费。
 * 生命周期与单次 dteam 工具调用绑定。
 */

import type { Signal, SignalType } from "../tools.js";

export class SignalBus {
  private byWorker = new Map<string, Signal[]>();
  private listeners = new Map<SignalType, Set<(s: Signal) => void>>();

  emit(signal: Signal): Signal {
    let list = this.byWorker.get(signal.workerId);
    if (!list) {
      list = [];
      this.byWorker.set(signal.workerId, list);
    }
    list.push(signal);

    const set = this.listeners.get(signal.type);
    if (set) {
      for (const fn of set) fn(signal);
    }
    return signal;
  }

  getHistory(workerId?: string): Signal[] {
    if (workerId) {
      return [...(this.byWorker.get(workerId) ?? [])];
    }
    const all: Signal[] = [];
    for (const list of this.byWorker.values()) all.push(...list);
    return all;
  }

  getByRun(runId: string): Signal[] {
    const all: Signal[] = [];
    for (const list of this.byWorker.values()) {
      for (const s of list) {
        if (s.runId === runId) all.push(s);
      }
    }
    return all;
  }

  on(type: SignalType, listener: (s: Signal) => void): () => void {
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }
}
