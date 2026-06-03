/**
 * P2-细胞层：事件流桥接器
 *
 * dteam 信息素层 P2 桥接器。把 SignalBus（内存）的事件流同步到 SignalLog（文件），
 * 提供 start / stop / view / seal 4 个方法。
 *
 * 设计依据：task `20260601175426-mtgl` 讨论决策 → 实施 task `20260601180517-9vc9` AC3。
 */

import type { Signal, SignalType } from "../P0/signal.js";
import { isExpired, type SignalEvent } from "../P0/signalEvent.js";
import type { SignalLog, RecentQuery } from "../P1/signalLog.js";

const ALL_TYPES: SignalType[] = ["progress", "blocked", "found", "help"];

/**
 * 事件流：把 SignalBus 的事件流桥接到 SignalLog 文件。
 *
 * 协作边界：
 *  - start() 后，bus 每发一条 4 类信号，自动 append 到 log
 *  - view() 合并 bus history（内存快路径）+ log recent（文件）按 id 去重
 *  - seal() 把当前 log 归档到 archive/，停止桥接
 *  - 不破坏 SignalBus 现有 API 签名
 */
export class EventStream {
  private unsubscribers: Array<() => void> = [];
  private running = false;

  constructor(
    private readonly bus: { on(type: SignalType, listener: (s: Signal) => void): () => void; getHistory(workerId?: string): Signal[] },
    private readonly log: SignalLog,
  ) {}

  /** 当前是否在订阅中 */
  get active(): boolean {
    return this.running;
  }

  /**
   * 启动：订阅 bus 4 种类型事件，自动 append 到 log。
   * 二次调用是 no-op。
   */
  start(): void {
    if (this.running) return;
    for (const type of ALL_TYPES) {
      const unsub = this.bus.on(type, (sig) => {
        void this.handle(sig);
      });
      this.unsubscribers.push(unsub);
    }
    this.running = true;
  }

  /**
   * 停止：取消所有订阅。二次调用是 no-op。
   */
  stop(): void {
    if (!this.running) return;
    for (const unsub of this.unsubscribers) {
      try {
        unsub();
      } catch {
        // 防御性：单个 unsub 失败不影响其他
      }
    }
    this.unsubscribers = [];
    this.running = false;
  }

  /**
   * 给 worker 的"我看得到什么"视图（合并 bus history + log recent 按 id 去重）。
   */
  async view(query: RecentQuery = {}): Promise<SignalEvent[]> {
    // 内存快路径：把 bus.getHistory() 转成 SignalEvent 形态
    const inMemory: SignalEvent[] = this.bus
      .getHistory()
      .map((s) => busToEvent(s));

    // 文件慢路径：log.recent（已做 TTL 软过滤）
    const fromFile = await this.log.recent({ ...query, limit: query.limit ?? 100, includeExpired: query.includeExpired });

    // 按 id 去重
    const seen = new Set<string>();
    const merged: SignalEvent[] = [];
    for (const ev of [...fromFile, ...inMemory]) {
      if (!seen.has(ev.id)) {
        seen.add(ev.id);
        merged.push(ev);
      }
    }

    merged.sort((a, b) => a.ts - b.ts);
    return merged.slice(-(query.limit ?? 100));
  }

  /**
   * 收口：归档当前 run 的所有事件到 archive/，停止桥接。
   */
  async seal(): Promise<{ sealedTo: string; count: number }> {
    this.stop();
    return await this.log.seal();
  }

  /** 把 bus 信号转成 SignalEvent 形态（用于 view 合并） */
  private async handle(sig: Signal): Promise<void> {
    const event: Omit<SignalEvent, "id" | "expiresAt"> = {
      type: sig.type,
      src: sig.workerId,
      ts: sig.timestamp,
      data: sig.data as Record<string, unknown>,
    };
    try {
      // 复用 bus 的 id，让 view() 能跨内存/文件去重
      await this.log.append(event, { id: sig.id });
    } catch (err) {
      // 桥接失败不应该让业务崩溃；记录到 console.error
      // TODO: 后续可接入 dteam logger
      console.error("[EventStream] append failed:", (err as Error).message);
    }
  }
}

/** bus.Signal → SignalEvent 形态转换（不重新分配 id） */
function busToEvent(sig: Signal): SignalEvent {
  return {
    id: sig.id,
    type: sig.type,
    src: sig.workerId,
    ts: sig.timestamp,
    data: sig.data as Record<string, unknown>,
  };
}

// Re-export for convenience
export type { SignalEvent, RecentQuery };
// 避免循环依赖时类型未导出的问题
export { isExpired };
