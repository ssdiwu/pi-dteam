import type { Tier } from "../types/dispatch.js";

export const SIGNAL_TOOL_NAME = "dteam_signal" as const;
export const REPORT_TOOL_NAME = "dteam_report" as const;
export const MAX_WORKERS_PER_DISPATCH = 32;

export type WorkerState = "queued" | "running" | "waiting" | "completed" | "failed" | "timed_out" | "cancelled" | "shutdown";
export type ParentResponse =
  | { type: "provide_context"; context: string }
  | { type: "grant_tools"; tools: string[] }
  | { type: "grant_tool_budget"; additionalCalls: number }
  | { type: "decision"; decision: string }
  | { type: "deny"; reason: string }
  | { type: "cancel"; reason: string };
export type RecoveryAction =
  | { action: "retry" }
  | { action: "escalate"; tier: Tier }
  | { action: "extend"; additionalMs: number }
  | { action: "stop"; reason?: string };
export type ControlAction =
  | { action: "steer"; instruction: string }
  | { action: "graceful_stop"; reason?: string }
  | { action: "cancel"; reason?: string };

export type DteamControlParams = { workerId: string } & ControlAction;
export interface DteamControlResult {
  workerId: string;
  action: ControlAction["action"];
  state: WorkerState;
  cancelInitiator?: "main";
  writeInterrupted?: { reason?: string; writeScope: string[] };
}

export const REPORT_OUTCOMES = ["completed", "partial"] as const;
export const WORKER_ACTIVITIES = ["inspected", "modified", "tested", "executed", "captured_visual"] as const;
export const VERIFICATION_DEPTHS = ["none", "inspection", "automated", "runtime", "visual"] as const;
export const VERIFICATION_STATUSES = ["passed", "failed", "partial", "not_run"] as const;

export type ReportOutcome = typeof REPORT_OUTCOMES[number];
export type WorkerActivity = typeof WORKER_ACTIVITIES[number];
export type VerificationDepth = typeof VERIFICATION_DEPTHS[number];
export type VerificationStatus = typeof VERIFICATION_STATUSES[number];
export interface ReportFact { claim: string; evidence: string }
export interface WorkerVerification {
  depth: VerificationDepth;
  status: VerificationStatus;
  evidence: string[];
  remaining?: string[];
}
export interface WorkerReport {
  outcome: ReportOutcome;
  summary: string;
  activities: WorkerActivity[];
  facts: ReportFact[];
  verification: WorkerVerification;
  uncertainties?: string[];
}
export interface ReportedFact extends ReportFact { workerId: string }
export interface Handoff {
  facts: ReportedFact[];
  constraints?: string[];
  uncertainties?: string[];
}

export interface ActionableFinding {
  summary: string;
  evidence: string;
  impact: string;
}

export interface WorkerRequest {
  title: string;
  task: string;
  tier: Tier;
  addTools?: string[];
  handoff?: Handoff;
  /** 获得 edit/write 的 worker 必须声明预期修改的项目相对路径。 */
  writeScope?: string[];
}

export interface DispatchAccepted {
  workerId: string;
  title: string;
  tier: Tier;
  state: "queued";
}

export type WorkerSignal =
  | { kind: "progress"; message: string; percent?: number }
  | ({ kind: "finding" } & ActionableFinding)
  | { kind: "request_context"; requestId: string; question: string; contextNeeded?: string }
  | { kind: "request_tools"; requestId: string; tools: string[]; reason: string }
  | { kind: "request_tool_budget"; requestId: string; reason: string }
  | { kind: "request_decision"; requestId: string; question: string; candidates?: string[]; recommendation?: string }
  | { kind: "blocked"; requestId: string; reason: string; action?: string };

export interface SignalEvent {
  signalId: string;
  workerId: string;
  at: number;
  kind: string;
  payload: unknown;
}

export interface TimeoutDiagnostic {
  requestId: string;
  totalBudgetMs: number;
  attemptBudgetMs: number;
  maxRecoveryBudgetMs: number;
  elapsedMs: number;
  lastActivity: string;
  currentTool: string;
  outputSummary: string;
}

/** 仅在 DTEAM_DIAGNOSTICS=1 的无文本 worker 失败时暴露的脱敏瞬时诊断。 */
export interface WorkerNoOutputDiagnostics {
  candidateModel: string;
  messageCount: number;
  messageRoles: string[];
  agentError?: string;
  lifecycleEvents: string[];
  elapsedMs: number;
}

export interface WorkerSnapshot {
  id: string;
  title: string;
  task: string;
  requestedTier: Tier;
  activeTier: Tier;
  fallbackTrail: Tier[];
  state: WorkerState;
  activeTools: string[];
  handoff?: Handoff;
  writeScope?: string[];
  report?: WorkerReport;
  toolCallCount?: number;
  toolCallBudget?: number;
  toolBudgetExtensionCount?: number;
  startedAt?: number;
  endedAt?: number;
  latestFinding?: string;
  liveText?: string;
  liveThinking?: string;
  liveTool?: string;
  lastActivity?: string;
  timeoutDiagnostic?: TimeoutDiagnostic;
  result?: string;
  error?: string;
  cancelReason?: string;
  cancelInitiator?: "user" | "main" | "system";
  terminalReason?: "user_cancelled" | "session_shutdown" | "timeout" | "error" | "missing_report";
  noOutputDiagnostics?: WorkerNoOutputDiagnostics;
}

export interface ParentEvent {
  type: "completed" | "failed" | "cancelled" | "finding" | "request" | "write_interrupted";
  workerId: string;
  title: string;
  payload: unknown;
}

export interface WaitRequest {
  workerId: string;
  requestId: string;
  kind: string;
  payload: unknown;
}
export interface WaitTarget {
  id: string;
  title: string;
}
export interface DteamWaitResult {
  reason: "worker_event" | "timeout";
  targetWorkers: WaitTarget[];
  waitedMs: number;
  timeoutMs: number;
  /** 本次 wait 实际消费的 parent events；迟到 wait 会一次返回全部匹配的已排队事件，timeout 时为空。 */
  events: ParentEvent[];
  /** worker_event 时是本次 events 涉及的 worker 快照；timeout 时是当时 waiting 或终态的目标 worker 快照。 */
  ready: WorkerSnapshot[];
  requests: WaitRequest[];
  /** 本轮未进入 ready 的目标 ID；尤其在 worker_event 时不表示仍在运行或仍需继续等待。 */
  pendingWorkerIds: string[];
}

export interface DteamDispatchParams { workers: WorkerRequest[] }
export interface DteamRespondParams { workerId: string; requestId: string; response: ParentResponse }
export interface DteamRecoverParams { workerId: string; requestId: string; action: RecoveryAction }
export interface DteamWaitParams { workerIds: string[]; timeoutMs: number }
