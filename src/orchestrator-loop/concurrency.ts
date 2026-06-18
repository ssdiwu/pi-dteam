/**
 * Adaptive Concurrency（自适应并发）— 0.6.0 Phase 3
 *
 * 决策依据：ADR 0005 第 17 条（Adaptive Concurrency）。
 * 参考 ant-colony ConcurrencyConfig：min/max/optimal/lastRateLimitAt。
 *
 * 429 自适应：
 *  - worker 执行遇到 429（rate limit）→ 记录 lastRateLimitAt，降并发（current = max(min, current-1)）
 *  - 一段时间无 429 → 缓慢升并发（current = min(max, current+1)）
 *
 * 用法：Orchestrator Loop 每轮决策后，用 acquire() 拿一个并发槽；worker 完成/429 时 release/recordRateLimit。
 */

export interface ConcurrencyConfig {
  /** 最小并发（降不破） */
  min: number;
  /** 最大并发（升不破） */
  max: number;
  /** 429 后冷却毫秒数：冷却期内不升并发 */
  cooldownMs: number;
  /** 连续成功多少次后升并发 */
  successStreakToRise: number;
}

export const DEFAULT_CONCURRENCY_CONFIG: ConcurrencyConfig = {
  min: 1,
  max: 4,
  cooldownMs: 30_000,
  successStreakToRise: 3,
};

/**
 * 自适应并发控制器。
 * 单 goal 生命周期（随 Orchestrator Loop 创建/销毁）。
 */
export class AdaptiveConcurrency {
  private current: number;
  private inFlight = 0;
  private lastRateLimitAt = 0;
  private successStreak = 0;

  constructor(private readonly config: ConcurrencyConfig = DEFAULT_CONCURRENCY_CONFIG) {
    // 起始并发：min（保守起步，逐步上升）
    this.current = config.min;
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
