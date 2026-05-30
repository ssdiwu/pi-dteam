/**
 * P0-原子层：状态机
 *
 * 轻量级状态转换验证，防止非法操作
 */

import { TaskStatus } from "./status.js";

// ── 转换矩阵 ──────────────────────────────────────────────────

const TRANSITIONS = new Set<string>([
  // 正向流程
  "pending→running",
  "running→done",
  "running→failed",
  
  // 阻塞流程
  "running→blocked",
  "blocked→running",
  
  // 取消流程
  "pending→cancelled",
  "running→cancelled",
  "blocked→cancelled",
]);

// ── 终态 ──────────────────────────────────────────────────────

const TERMINAL = new Set<TaskStatus>(["done", "failed", "cancelled"]);

// ── 验证函数 ──────────────────────────────────────────────────

/**
 * 检查状态转换是否合法
 *
 * @param from 当前状态
 * @param to 目标状态
 * @returns 是否合法
 */
export function isValidTransition(from: TaskStatus, to: TaskStatus): boolean {
  if (from === to) return false; // 禁止自转换
  if (TERMINAL.has(from)) return false; // 终态不能转换
  return TRANSITIONS.has(`${from}→${to}`);
}

/**
 * 获取从指定状态可以转换到的状态列表
 *
 * @param from 当前状态
 * @returns 可转换的状态列表
 */
export function getValidTransitions(from: TaskStatus): TaskStatus[] {
  const transitions: TaskStatus[] = [];
  
  for (const transition of TRANSITIONS) {
    const [fromStage, toStage] = transition.split("→");
    if (fromStage === from) {
      transitions.push(toStage as TaskStatus);
    }
  }
  
  return transitions;
}

/**
 * 检查状态是否为终态
 *
 * @param status 状态
 * @returns 是否为终态
 */
export function isTerminal(status: TaskStatus): boolean {
  return TERMINAL.has(status);
}
