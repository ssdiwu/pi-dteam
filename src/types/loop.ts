/**
 * dteam 0.6.0 — Orchestrator Loop 核心类型
 *
 * 与旧二维编排类型（ExecutionPlan/PlanStep/SchedulingPlan，位于 tools.ts）并存。
 * 新代码（orchestrator-loop.ts）只用这里的类型；旧代码不动。
 *
 * 决策依据：ADR 0005
 *  - 第 8 条：无预先 Task Plan，召唤轨迹（SummonStep[]）即计划
 *  - 第 17 条：LLM-Driven Orchestration，每轮一次 LLM 调用输出 OrchestratorDecision
 *  - 第 14 条：强制 check 收口，Orchestrator 不能自停
 */

import type { RoleName } from "./role.js";
import type { Signal } from "./signal.js";

/** 0.6.0 类型版本标记，便于和旧类型区分 */
export const LOOP_TYPES_VERSION = "0.6.0" as const;

// ═══ SignalStore 接口 ═══

/**
 * SignalStore 的最小契约（供 orchestrator-loop.ts 依赖，不绑死实现）。
 * 完整实现在 src/signals/signal-store.ts。
 */
export interface ISignalStore {
  emit(signal: Signal): Signal;
  getActive(now?: number): Signal[];
  getAll(): Signal[];
  getActiveByWorker(workerId: string, now?: number): Signal[];
  getActiveByType(type: Signal["type"], now?: number): Signal[];
  on(type: Signal["type"], listener: (s: Signal) => void): () => void;
  size(): number;
  activeSize(now?: number): number;
  getGoalId(): string;
  dispose(): void;
}

// ═══ 召唤轨迹（summonTrail）═══

/**
 * 一次召唤的记录。是 0.6.0 的"计划项"——但它是事中涌现的，
 * 不是预先穷举的。Orchestrator Loop 每召唤一个 worker 就 append 一条。
 *
 * 注意：和旧 PlanStep 的区别
 *  - PlanStep：预先穷举的计划项（mode + role + task + strategy）
 *  - SummonStep：实际召唤的轨迹项（role + task + 实际结果 + 信号 + 用了哪个模型）
 */
export interface SummonStep {
  /** 轨迹内唯一 id，如 summon-1 / summon-2 */
  id: string;
  /** 召唤的角色（固定五角色之一） */
  role: RoleName;
  /** 给 worker 的任务说明（Orchestrator LLM 决策时拼装） */
  task: string;
  /** worker 执行结果（done 后填） */
  result?: string;
  /** worker 执行状态 */
  status: "running" | "done" | "failed" | "skipped";
  /** 该 worker 期间产生的信号 */
  signals: Signal[];
  /** 实际使用的模型（含 fallback，用于 Multi-Provider Routing 追溯） */
  model?: string;
  /** 该 worker 的工具白名单（Logical Isolation） */
  tools?: string[];
  /** 时间戳 */
  startedAt: number;
  finishedAt?: number;
}

// ═══ Orchestrator LLM 决策 ═══

/**
 * Orchestrator 每轮一次 LLM 调用的输出。
 *
 * LLM 看到的输入：goal + SignalStore 当前快照 + 已完成 SummonStep 结果。
 * LLM 输出：下一步召唤谁 / 给它什么任务 / 还是已经该收口。
 *
 * 决策类型（Orchestrator LLM 用 JSON 输出）：
 *  - "summon"：召唤一个 worker（role + task + 可选 tools）
 *  - "check"：召唤 check 角色收口（Completion Gate）
 *  - "done"：check 已通过，Loop 结束（仅 check pass 后 Orchestrator 才会产出）
 *  - "fail"：无法继续，标记失败收口
 */
export type OrchestratorDecision =
  | OrchestratorSummonDecision
  | OrchestratorCheckDecision
  | OrchestratorDoneDecision
  | OrchestratorFailDecision;

export interface OrchestratorSummonDecision {
  type: "summon";
  role: RoleName;
  task: string;
  reason: string;
  /** 0.6.0 Phase 3：可选并发召唤数量。>1 时 loop 用 Adaptive Concurrency 并行召唤。
   *  缺省 1（串行）。Orchestrator 可在任务可拆分时填更大值。 */
  parallel?: number;
  tools?: string[];
}

export interface OrchestratorCheckDecision {
  type: "check";
  /** check 任务说明（check worker 要验证什么） */
  task: string;
  /** 决策理由 */
  reason: string;
}

export interface OrchestratorDoneDecision {
  type: "done";
  /** 完成理由 */
  reason: string;
}

export interface OrchestratorFailDecision {
  type: "fail";
  /** 失败原因 */
  reason: string;
}

// ═══ check 收口结论 ═══

/**
 * check 角色的收口结论（Completion Gate）。
 *
 * check 是固定五角色之一，但它的输出要走结构化判定：
 * pass → Orchestrator 才能产出 "done"
 * reject → Orchestrator 继续召唤（通常是 build 修复）直到 maxRounds
 */
export interface CheckResult {
  /** check 是否通过 */
  passed: boolean;
  /** check 的完整输出（人类可读） */
  output: string;
  /** 未通过时的关键问题（结构化，供 Orchestrator 决策如何修复） */
  issues?: string[];
  /** check 轮次（1 = 首次收口，2+ = 修复后再 check） */
  round: number;
}

// ═══ Loop 最终结果 ═══

/**
 * 0.6.0 Orchestrator Loop 的最终结果（DteamResult6）。
 *
 * 和旧 RunResult 的区别：
 *  - 无 plan / steps / mode / fileGraph / scheduling（二维编排结构）
 *  - 用 summonTrail（召唤轨迹）替代预先 plan
 *  - signalSnapshot（SignalStore 最终快照）替代 signalBus.getHistory
 *  - checkConclusion 显式承载收口结论（Completion Gate）
 */
export interface DteamResult6 {
  /** 整体状态：done 需要 check passed；failed = 收口失败或异常 */
  status: "done" | "failed";
  /** 原始 goal */
  goal: string;
  /** 召唤轨迹（事中涌现的计划） */
  summonTrail: SummonStep[];
  /** SignalStore 最终快照（所有信号，含已衰减，用于 report） */
  signalSnapshot: Signal[];
  /** check 收口结论 */
  checkConclusion: CheckResult;
  /** 人类可读摘要 */
  summary: string;
  /** Loop 耗时（毫秒） */
  elapsedMs: number;
  /** 0.6.0 类型版本标记 */
  readonly version: typeof LOOP_TYPES_VERSION;
}

// ═══ Loop 配置 ═══

/**
 * Orchestrator Loop 的运行配置（防死循环 + 收口策略）。
 */
export interface LoopConfig {
  /** 最大召唤轮次（防 Orchestrator 无限循环）；默认 15 */
  maxRounds: number;
  /** check reject 后最大重试轮次（防 check/build 反复横跳）；默认 3 */
  maxCheckRetries: number;
  /** Orchestrator LLM 每轮决策的超时（毫秒）；默认 60_000 */
  decisionTimeoutMs: number;
}

export const DEFAULT_LOOP_CONFIG: LoopConfig = {
  maxRounds: 15,
  maxCheckRetries: 3,
  decisionTimeoutMs: 60_000,
};
