/**
 * P0-原子层：信号定义
 */

export type SignalType = "progress" | "blocked" | "found" | "help";
export type StrategyType = "retry" | "adjust" | "switch" | "replan" | "learn";

export interface Signal {
  id: string;
  type: SignalType;
  workerId: string;
  timestamp: number;
  data: Record<string, unknown>;
}

export interface Strategy {
  type: StrategyType;
  description: string;
  params?: Record<string, unknown>;
}
