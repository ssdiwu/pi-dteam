/**
 * dteam v1 — 信号类型（P0-原子层，对齐 v0 协议）
 * Signal + 4 payload + SignalType。
 */

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
  errorType: "timeout" | "rate_limit" | "auth" | "permission" | "logic" | "missing_dependency" | "missing_info" | "syntax" | "test_failure" | "unknown";
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
