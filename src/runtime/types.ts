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
  | { type: "deny"; reason: string };
export type RecoveryAction =
  | { action: "retry" }
  | { action: "escalate"; tier: Tier }
  | { action: "extend"; additionalMs: number }
  | { action: "stop"; reason?: string };

export interface ReportFact { claim: string; evidence: string }
export interface WorkerReport { summary: string; facts: ReportFact[]; uncertainties?: string[] }
export interface ReportedFact extends ReportFact { workerId: string }
export interface Handoff {
  facts: ReportedFact[];
  constraints?: string[];
  uncertainties?: string[];
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
  | { kind: "finding"; summary: string; evidence?: string }
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
  terminalReason?: "user_cancelled" | "session_shutdown" | "timeout" | "error" | "missing_report";
}

export interface ParentEvent {
  type: "completed" | "failed" | "cancelled" | "request" | "write_interrupted";
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
  ready: WorkerSnapshot[];
  requests: WaitRequest[];
  pendingWorkerIds: string[];
}

export interface DteamDispatchParams { workers: WorkerRequest[] }
export interface DteamRespondParams { workerId: string; requestId: string; response: ParentResponse }
export interface DteamRecoverParams { workerId: string; requestId: string; action: RecoveryAction }
export interface DteamWaitParams { workerIds: string[]; timeoutMs: number }
