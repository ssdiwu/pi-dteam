/**
 * dteam v1 — 类型定义
 *
 * 所有核心类型集中在这里。
 */

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

/** 5 个角色 */
export type RoleName = "explore" | "design" | "build" | "check" | "close";

/** Plan 的一个步骤 */
export interface PlanStep {
  role: RoleName;
  task: string;
  strategy: Strategy;
  files?: string[];
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
}
