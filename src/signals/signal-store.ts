/**
 * SignalStore（信号存储）— 0.6.0 Orchestrator Loop 的临时信号空间
 *
 * 与 SignalBus 的区别：
 *  - SignalBus：v0.4.x 的事件总线（worker → 根的实时转发，按 workerId/runId 索引）
 *  - SignalStore：0.6.0 Orchestrator 的决策依据（按 goal 生命周期、TTL 衰减、
 *    只读 active 快照供每轮 LLM 决策）
 *
 * 决策依据（ADR 0005 第 6、12 条）：
 *  - 临时：单 goal 的 Orchestrator Loop 内维护，不落项目目录
 *  - TTL 衰减：新信号优先影响决策，旧信号过期失效
 *  - 复用现有 Signal 类型：不重新发明语义（progress/found/blocked/help）
 *
 * 设计权衡：
 *  - TTL 用"创建时间 + 半衰期"而非硬过期，避免信号在决策瞬间突然消失；
 *    getActive 只返回 strength > 0 的信号，strength = 2^(-(age/halfLife))
 *  - 单 goal：构造时传 goalId，dispose() 清空；不跨 goal
 */

import type { Signal, SignalType } from "../tools.js";
import type { ISignalStore } from "../types/loop.js";

/** SignalStore 配置 */
export interface SignalStoreOptions {
  /** 半衰期（毫秒）：age = halfLife 时 strength = 0.5；默认 10 分钟 */
  halfLifeMs?: number;
  /** strength 低于此值视为过期，getActive 不返回；默认 0.05 */
  expiryThreshold?: number;
  /** 最多保留多少条信号（防止无限堆积）；默认 200 */
  maxSignals?: number;
}

/**
 * 信号在 store 里的包装条目，附 strength 计算。
 * 不修改原 Signal 对象（保持向后兼容）。
 */
interface StoredSignal {
  signal: Signal;
  /** 入库时间（用于 strength 计算） */
  storedAt: number;
}

export class SignalStore implements ISignalStore {
  private readonly goalId: string;
  private readonly halfLifeMs: number;
  private readonly expiryThreshold: number;
  private readonly maxSignals: number;
  private signals: StoredSignal[] = [];
  private listeners = new Map<SignalType, Set<(s: Signal) => void>>();
  private disposed = false;

  constructor(goalId: string, options: SignalStoreOptions = {}) {
    this.goalId = goalId;
    this.halfLifeMs = options.halfLifeMs ?? 10 * 60 * 1000;
    this.expiryThreshold = options.expiryThreshold ?? 0.05;
    this.maxSignals = options.maxSignals ?? 200;
  }

  /** 写入一个信号。新信号 strength = 1，随时间衰减。 */
  emit(signal: Signal): Signal {
    this.assertNotDisposed();
    this.signals.push({ signal, storedAt: Date.now() });

    // 超过上限：丢弃最旧（strength 最低的也通常是旧的，这里按时间顺序丢头部）
    if (this.signals.length > this.maxSignals) {
      this.signals.splice(0, this.signals.length - this.maxSignals);
    }

    // 触发监听器（实时通知，不区分是否过期）
    const set = this.listeners.get(signal.type);
    if (set) {
      for (const fn of set) fn(signal);
    }
    return signal;
  }

  /**
   * 当前 strength（0~1），基于入库后经过的时间。
   * strength = 2^(-age/halfLife)，age=halfLife 时 strength=0.5。
   */
  strength(storedAt: number, now: number = Date.now()): number {
    const age = now - storedAt;
    if (age <= 0) return 1;
    return Math.pow(2, -age / this.halfLifeMs);
  }

  /** 取当前活跃信号（strength > expiryThreshold），按 strength 降序。 */
  getActive(now: number = Date.now()): Signal[] {
    this.assertNotDisposed();
    return this.signals
      .map(s => ({ ...s, s: this.strength(s.storedAt, now) }))
      .filter(s => s.s > this.expiryThreshold)
      .sort((a, b) => b.s - a.s)
      .map(s => s.signal);
  }

  /** 取全部历史信号（含已衰减的，按时间顺序）。用于 report 回溯。 */
  getAll(): Signal[] {
    this.assertNotDisposed();
    return this.signals.map(s => s.signal);
  }

  /** 按 workerId 过滤活跃信号。 */
  getActiveByWorker(workerId: string, now: number = Date.now()): Signal[] {
    return this.getActive(now).filter(s => s.workerId === workerId);
  }

  /** 按类型过滤活跃信号。 */
  getActiveByType(type: SignalType, now: number = Date.now()): Signal[] {
    return this.getActive(now).filter(s => s.type === type);
  }

  /** 注册监听器（实时，收到新 emit 即触发）。返回取消订阅函数。 */
  on(type: SignalType, listener: (s: Signal) => void): () => void {
    this.assertNotDisposed();
    let set = this.listeners.get(type);
    if (!set) {
      set = new Set();
      this.listeners.set(type, set);
    }
    set.add(listener);
    return () => set!.delete(listener);
  }

  /** 当前信号总数（含已衰减）。 */
  size(): number {
    return this.signals.length;
  }

  /** 活跃信号数。 */
  activeSize(now: number = Date.now()): number {
    return this.getActive(now).length;
  }

  /** goal 标识。 */
  getGoalId(): string {
    return this.goalId;
  }

  /**
   * 销毁 store：清空信号和监听器。
   * 单 goal 生命周期结束（Orchestrator Loop 收口）时调用。
   */
  dispose(): void {
    this.disposed = true;
    this.signals = [];
    this.listeners.clear();
  }

  private assertNotDisposed(): void {
    if (this.disposed) {
      throw new Error("SignalStore: 已 dispose，不可再操作（单 goal 生命周期已结束）");
    }
  }
}
