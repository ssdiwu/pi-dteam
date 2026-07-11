/**
 * Adaptive Concurrency（自适应并发）— 0.7 dispatch 基底
 *
 * 决策依据：ADR 0005 的可复用执行基底；ADR 0008 保留它但不保留 Orchestrator Loop。
 * 参考 ant-colony ConcurrencyConfig：min/max/optimal/lastRateLimitAt。
 *
 * 429 自适应：
 *  - worker 执行遇到 429（rate limit）→ 记录 lastRateLimitAt，降并发（current = max(min, current-1)）
 *  - 一段时间无 429 → 缓慢升并发（current = min(max, current+1)）
 *
 * 用法：多个并发 dteam_dispatch 共用同一 limiter；worker 执行前 acquire，完成或 429 后 release/recordRateLimit。
 */

export interface ConcurrencyConfig {
  /** 最小并发（429 后降不破） */
  min: number;
  /** 最大并发（升不破） */
  max: number;
  /** 冷启动并发；省略时取 min。默认让首批 T3 dispatch 可并行。 */
  initial?: number;
  /** 429 后冷却毫秒数：冷却期内不升并发 */
  cooldownMs: number;
  /** 连续成功多少次后升并发 */
  successStreakToRise: number;
}

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  min: 1,
  max: 4,
  initial: 2,
  cooldownMs: 30_000,
  successStreakToRise: 3,
};

/**
 * 自适应并发控制器。
 * 由入口按 extension 运行时共享；只维护并发槽，不维护 goal、任务计划或执行循环。
 */
export class AdaptiveConcurrency {
  private current: number;
  private inFlight = 0;
  private lastRateLimitAt = 0;
  private successStreak = 0;

  constructor(private readonly config: ConcurrencyConfig = DEFAULT_CONCURRENCY_CONFIG) {
    const initial = config.initial ?? config.min;
    this.current = Math.max(config.min, Math.min(config.max, initial));
  }

  /** 当前允许的并发上限 */
  get limit(): number {
    return this.current;
  }

  /** 当前在飞 worker 数 */
  get flying(): number {
    return this.inFlight;
  }

  /** 是否还有空闲并发槽 */
  hasSlot(): boolean {
    return this.inFlight < this.current;
  }

  /**
   * 占用一个并发槽。无槽时返回 false（调用方应等待或串行执行）。
   */
  acquire(): boolean {
    if (!this.hasSlot()) return false;
    this.inFlight += 1;
    return true;
  }

  /** 释放一个并发槽（worker 完成）。连续成功足够则升并发。 */
  release(success: boolean = true): void {
    if (this.inFlight > 0) this.inFlight -= 1;
    if (success) {
      this.successStreak += 1;
      this.maybeRise();
    } else {
      this.successStreak = 0;
    }
  }

  /** 记录一次 429：立即降并发，进入冷却 */
  recordRateLimit(): void {
    this.lastRateLimitAt = Date.now();
    this.successStreak = 0;
    this.current = Math.max(this.config.min, this.current - 1);
  }

  /** 是否在冷却期 */
  isCoolingDown(now: number = Date.now()): boolean {
    return now - this.lastRateLimitAt < this.config.cooldownMs;
  }

  /** 连续成功足够且不在冷却期 → 升并发 */
  private maybeRise(): void {
    if (this.isCoolingDown()) return;
    if (this.successStreak >= this.config.successStreakToRise) {
      this.current = Math.min(this.config.max, this.current + 1);
      this.successStreak = 0;
    }
  }
}
