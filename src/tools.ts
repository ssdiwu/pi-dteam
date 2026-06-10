/**
 * dteam v1 — 类型中心
 *
 * - 旧类型（Task / Decision）保留（brancher 强依赖）
 * - 二维编排类型（PlanStep / ExecutionPlan / RunResult 等）保留（orchestrator 依赖）
 * - ADR 架构模式类型保留（reference-data 依赖）
 * - 4 类已拆分到 src/types/* 的类型在此 re-export，保证外部 `from "./tools.js"` 不破
 */

import type { RoleName } from "./types/role.js";
import type { Signal } from "./types/signal.js";
import type { WorkerRun } from "./types/run.js";

export type { RoleName } from "./types/role.js";
export type { SignalType, SignalPayload, Signal, ProgressPayload, FoundPayload, BlockedPayload, HelpPayload } from "./types/signal.js";
export type { WorkerRun, WorkerRunStatus, ISignalBus, IRunsStore } from "./types/run.js";
export type { DteamContext } from "./types/context.js";

// ═══ 旧类型（brancher 递归分解用，保留向后兼容） ═══

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface Task {
  id: string;
  parentId: string | null;
  title: string;
  description: string;
  status: TaskStatus;
  result?: string;
  createdAt: number;
}

export type Decision =
  | { kind: "execute"; reason: string }
  | { kind: "decompose"; reason: string; subTasks: Array<{ title: string; description: string }> };

// ═══ 二维编排类型 ═══

/** 维度一：组织形式 */
export type ExecMode = "solo" | "chain" | "team";

/** 维度二：执行策略（每个 step 独立选择） */
export type Strategy = "direct" | "build_check" | "adaptive";

/** Plan 的一个步骤 */
export interface PlanStep {
  role: RoleName;
  task: string;
  strategy: Strategy;
  files?: string[];
  /**
   * 显式指定此 step 用的工具子集（0.4.1 已落地，方案 D）。
   * 由 planner LLM 路径根据主 LLM 传入的 availableTools 决定；规则路径不填。
   * undefined → 降级到 ROLE_DEFAULTS[role].tools（0.4.0 兼容行为）。
   * 设计：见 doc/40-版本实施方案/41-工具动态加载方案.md
   */
  tools?: string[];
}

/** Phase 1 输出：执行计划 */
export interface ExecutionPlan {
  mode: ExecMode;
  steps: PlanStep[];
  reason: string;
}

/** 一个步骤的执行结果 */
export interface StepResult {
  role: RoleName;
  task: string;
  strategy: Strategy;
  status: "done" | "failed";
  output: string;
  /** build_check / adaptive 的循环轮次 */
  rounds?: number;
}

/** orchestrator 的总返回 */
export interface RunResult {
  status: "done" | "failed";
  goal: string;
  plan: ExecutionPlan;
  steps: StepResult[];
  summary: string;
  /** 信号总线收集的所有信号 */
  signals?: Signal[];
  /** runs 存储中所有 worker 的最终状态 */
  workers?: WorkerRun[];
  /** task 池统计 */
  taskSummary?: { total: number; done: number; failed: number };
}

// ═══ ADR 架构模式类型（阶段 2 用） ═══

export type ArchitectureCategory =
  | "monolith" | "microservices" | "layered" | "hexagonal"
  | "event-driven" | "cqrs" | "serverless"
  | "microkernel" | "pipe-filter" | "space-based"
  | "client-server" | "peer-to-peer";

export interface ArchitecturePattern {
  name: string;
  category: ArchitectureCategory;
  description: string;
  pros: string[];
  cons: string[];
  bestFor: string[];
  worstFor: string[];
  adrTemplate: string;
}
