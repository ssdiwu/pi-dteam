/**
 * dteam/leaf/worker-id.ts — workerId 生成器（单点）
 *
 * 【重构方案】Phase 3 - C 拆出。修 L-3：消除 orchestrator + leaf 两处
 * 重复的 `w-${role}-${ts}-${rand}` 命名。
 *
 * 约定格式：w-{role}-{ts}-{rand4}。ts 部分对人类友好，rand 防止同 ts 撞。
 */

import type { RoleName } from "../types/role.js";

export function nextWorkerId(role: RoleName): string {
  const ts = Date.now();
  const rand = Math.random().toString(36).slice(2, 6);
  return `w-${role}-${ts}-${rand}`;
}
