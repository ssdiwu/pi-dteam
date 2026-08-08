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
/** control 已离开 Pi 队列只表示已注入下一 agent turn，不表示 worker 已理解或执行。 */
export type ControlDeliveryState = "queued" | "injected" | "superseded" | "expired";
export interface ControlCommandSnapshot {
  commandId: string;
  action: "steer" | "graceful_stop";
  deliveryState: ControlDeliveryState;
  createdAt: number;
}
export interface DteamControlResult {
  workerId: string;
  action: ControlAction["action"];
  state: WorkerState;
  /** 仅 steer / graceful_stop：已提交队列或可观察到离开队列的内部投递状态。 */
  commandId?: string;
  deliveryState?: ControlDeliveryState;
  supersededCommandIds?: string[];
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

export interface WorkerContextUsage {
  /** Pi 估算的当前 candidate context tokens；压缩后可为 null。 */
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
  sampledAt: number;
}
export interface PendingRequestSnapshot {
  requestId: string;
  kind: string;
  /** 脱敏且有界的 question / reason / tools 摘要，不保留原始 payload。 */
  summary?: string;
  /** dteam_respond 可接受的具体 response.type；timeout_recovery 为空并走 dteam_recover。 */
  responseTypes: ParentResponse["type"][];
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
  /** 当前 active candidate 的只读上下文采样；缺 API 时省略。 */
  contextUsage?: WorkerContextUsage;
  /** 当前 worker 的脱敏 pending request 投影。 */
  pendingRequests?: PendingRequestSnapshot[];
  /** 最近一条当前 candidate control 的真实队列状态；不代表已执行。 */
  latestControl?: ControlCommandSnapshot;
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

/** dteam_wait 对主代理与会话记录暴露的有界投影；不携带 WorkerSnapshot.task 或原始 event/request payload。 */
export interface DteamWaitEventView {
  type: ParentEvent["type"];
  workerId: string;
  title: string;
  findings?: ActionableFinding[];
  writeScope?: string[];
  reason?: string;
  error?: string;
}
export interface DteamWaitWorkerView {
  id: string;
  title: string;
  state: WorkerState;
  writeScope?: string[];
  report?: WorkerReport;
  error?: string;
  timeoutDiagnostic?: Pick<TimeoutDiagnostic, "lastActivity">;
}
export interface DteamWaitRequestView extends PendingRequestSnapshot { workerId: string }
export interface DteamWaitView {
  reason: DteamWaitResult["reason"];
  targetWorkers: WaitTarget[];
  waitedMs: number;
  timeoutMs: number;
  events: DteamWaitEventView[];
  ready: DteamWaitWorkerView[];
  requests: DteamWaitRequestView[];
  pendingWorkerIds: string[];
}

export interface DteamDispatchParams { workers: WorkerRequest[] }
export interface DteamRespondParams { workerId: string; requestId: string; response: ParentResponse }
export interface DteamRecoverParams { workerId: string; requestId: string; action: RecoveryAction }
export interface DteamWaitParams { workerIds: string[]; timeoutMs: number }
