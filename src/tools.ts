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
  /** 信号总线收集的所有信号 */
  signals?: Signal[];
  /** runs 存储中所有 worker 的最终状态 */
  workers?: WorkerRun[];
  /** task 池统计 */
  taskSummary?: { total: number; done: number; failed: number };
}

// ═══ 信号类型（P0-原子层，对齐 v0 协议） ═══

export type SignalType = "progress" | "found" | "blocked" | "help";

/** progress：完成一个动作/步骤后 */
export interface ProgressPayload {
  action: "create" | "modify" | "delete" | "read" | "run" | "config";
  target: string;
  summary: string;
  acImpact?: Array<{ id: string; status: "done" | "partial" | "blocked"; evidence: string }>;
  percent?: number;
}

/** found：发现计划外信息但能继续 */
export interface FoundPayload {
  summary: string;
  files?: string[];
  severity: "info" | "warning" | "critical";
  category: "dependency" | "risk" | "opportunity" | "conflict" | "unknown";
  suggestion?: string;
}

/** blocked：已经停住/失败 */
export interface BlockedPayload {
  errorType:
    | "timeout" | "rate_limit" | "auth" | "permission"
    | "logic" | "missing_dependency" | "missing_info"
    | "syntax" | "test_failure" | "unknown";
  message: string;
  files?: string[];
  lastAction?: string;
  afterHelp?: boolean;
}

/** help：自己解决不了但还没死 */
export interface HelpPayload {
  whatMissing: string;
  context: string;
  focusFiles?: string[];
  suggestedHelper?: "explore" | "check" | "build" | "design";
  suggestedDirection?: string;
  urgency: "low" | "medium" | "high";
  progressSummary: string;
  attemptsSummary: string;
  helpReason: string;
}

export type SignalPayload = ProgressPayload | FoundPayload | BlockedPayload | HelpPayload;

/** 信号 */
export interface Signal {
  id: string;
  type: SignalType;
  workerId: string;
  runId: string;
  timestamp: number;
  data: SignalPayload;
}

// ═══ Runs / Worker 类型 ═══

export type WorkerRunStatus = "running" | "done" | "failed" | "blocked";

export interface WorkerRun {
  id: string;
  role: RoleName;
  task: string;
  input: string;
  output?: string;
  signals: Signal[];
  startedAt: number;
  finishedAt?: number;
  status: WorkerRunStatus;
}

// ═══ 信号总线 & Runs 存储（接口，避免循环依赖） ═══

export interface ISignalBus {
  emit(signal: Signal): Signal;
  getHistory(workerId?: string): Signal[];
  getByRun(runId: string): Signal[];
  on(type: SignalType, listener: (s: Signal) => void): () => void;
}

export interface IRunsStore {
  createRun(): string;
  addWorker(runId: string, worker: WorkerRun): void;
  getWorker(runId: string, workerId: string): WorkerRun | null;
  getAllWorkers(runId: string): WorkerRun[];
  appendSignal(runId: string, workerId: string, signal: Signal): void;
  finishWorker(runId: string, workerId: string, output: string, status: WorkerRunStatus): void;
}

/** dteam 信号通路上下文 */
export interface DteamContext {
  signalBus: ISignalBus;
  runsStore: IRunsStore;
  runId: string;
  workerId: string;
  /** 叶子 help 后等待补充信息的 resolve 队列 */
  pendingSupplements: Map<string, (value: string | null) => void>;
  /** 实时转发队列：根→叶子的补充知识，key = workerId，value = 补充队列 */
  injectionQueue: Map<string, string[]>;
  /** 当前 step 的 UI workerId（orchestrator 设置，leaf 读取） */
  currentStepId?: string;
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
