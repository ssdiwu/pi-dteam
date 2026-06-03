/**
 * P1-分子层：信号总线
 */

import { Signal, SignalType } from "../P0/signal.js";

export class SignalBus {
  private listeners: Map<SignalType, Array<(signal: Signal) => void>> = new Map();
  private history: Signal[] = [];

  /**
   * 发送信号
   */
  emit(type: SignalType, workerId: string, data: Record<string, unknown> = {}): Signal {
    const signal: Signal = {
      id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      type,
      workerId,
      timestamp: Date.now(),
      data,
    };

    this.history.push(signal);

    const listeners = this.listeners.get(type) || [];
    for (const listener of listeners) {
      listener(signal);
    }

    return signal;
  }

  /**
   * 监听信号
   */
  on(type: SignalType, listener: (signal: Signal) => void): () => void {
    if (!this.listeners.has(type)) {
      this.listeners.set(type, []);
    }
    this.listeners.get(type)!.push(listener);

    return () => {
      const listeners = this.listeners.get(type);
      if (listeners) {
        const index = listeners.indexOf(listener);
        if (index > -1) {
          listeners.splice(index, 1);
        }
      }
    };
  }

  /**
   * 获取信号历史
   */
  getHistory(workerId?: string): Signal[] {
    if (workerId) {
      return this.history.filter((s) => s.workerId === workerId);
    }
    return [...this.history];
  }
}
