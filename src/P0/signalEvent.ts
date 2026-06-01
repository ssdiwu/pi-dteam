/**
 * P0-原子层：信号事件
 *
 * dteam 信息素层的原子数据单元。基于 dteam 4 种 SignalType 扩展，
 * 增加 TTL 衰减、taskId 关联、severity 等字段，供 P1 SignalLog 持久化。
 *
 * 设计依据：task `20260601175426-mtgl` 讨论决策 → 实施 task `20260601180517-9vc9` AC1。
 */

import type { SignalType } from "./signal.js";

/**
 * 信号事件：dteam 信息素层的原子数据单元。
 *
 * 复用 dteam 4 种 SignalType，可选带 taskId 关联和 ttl 衰减。
 * 与 SignalBus 的 Signal（进程内）相对，SignalEvent 是文件级持久化形态。
 */
export interface SignalEvent {
  /** 唯一 ID：复用 signal-<ts>-<rand> 格式 */
  id: string;
  /** 信号类型（4 种） */
  type: SignalType;
  /** 发出方 workerId */
  src: string;
  /** 毫秒时间戳 */
  ts: number;
  /** 关联 task id（关键：让事件可追溯到 task） */
  taskId?: string;
  /** TTL 毫秒；不设则永不过期 */
  ttl?: number;
  /** 计算字段：ts + ttl；undefined 视为永不过期 */
  expiresAt?: number;
  /** 事件负载 */
  data?: Record<string, unknown>;
  /** 依赖引用（文件路径 / 任务 id / worker id） */
  refs?: string[];
  /** 严重度（blocked 类事件用） */
  severity?: "low" | "med" | "high";
  /** 产出文件路径（progress/done 用） */
  artifacts?: string[];
}

/**
 * 计算 expiresAt 字段。
 *
 * @param event 缺 id 和 expiresAt 的事件
 * @returns expiresAt（ts + ttl）；ttl 未设时返回 undefined（永不过期）
 */
export function computeExpiresAt(
  event: Omit<SignalEvent, "id" | "expiresAt">,
): number | undefined {
  if (event.ttl === undefined) return undefined;
  return event.ts + event.ttl;
}

/**
 * 判断事件是否过期。
 *
 * @param event 事件
 * @param now 当前时间戳（默认 Date.now()，便于测试注入）
 * @returns true=已过期 / false=未过期或永不过期
 */
export function isExpired(
  event: SignalEvent,
  now: number = Date.now(),
): boolean {
  if (event.expiresAt === undefined) return false;
  return now >= event.expiresAt;
}
