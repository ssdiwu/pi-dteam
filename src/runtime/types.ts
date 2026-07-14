import type { Tier } from "../types/dispatch.js";

export const SIGNAL_TOOL_NAME = "dteam_signal" as const;
export const MAX_WORKERS_PER_DISPATCH = 32;

export type WorkerState = "queued" | "running" | "waiting" | "completed" | "failed" | "timed_out" | "cancelled" | "shutdown";
export type ParentResponse =
  | { type: "provide_context"; context: string }
  | { type: "grant_tools"; tools: string[] }
  | { type: "decision"; decision: string }
  | { type: "deny"; reason: string };

export interface WorkerRequest {
  title: string;
  task: string;
  tier: Tier;
  addTools?: string[];
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
  | { kind: "request_decision"; requestId: string; question: string; candidates?: string[]; recommendation?: string }
  | { kind: "blocked"; requestId: string; reason: string; action?: string };

export interface SignalEvent {
  signalId: string;
  workerId: string;
  at: number;
  kind: string;
  payload: unknown;
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
  startedAt?: number;
  endedAt?: number;
  latestFinding?: string;
  result?: string;
  error?: string;
  cancelReason?: string;
  terminalReason?: "user_cancelled" | "session_shutdown" | "timeout" | "error";
}

export interface ParentEvent {
  type: "completed" | "failed" | "cancelled" | "request";
  workerId: string;
  title: string;
  payload: unknown;
}

export interface DteamDispatchParams { type: "dispatch"; workers: WorkerRequest[] }
export interface DteamRespondParams { type: "respond"; workerId: string; requestId: string; response: ParentResponse }
export type DteamParams = DteamDispatchParams | DteamRespondParams;
