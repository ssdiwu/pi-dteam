/**
 * signals/index.ts — dteam 信号系统统一导出
 *
 * 对外暴露：SignalBus / RunsStore / SignalStore / 所有信号相关类型。
 * 其他模块只从这里 import，不直接引用子文件。
 */

export { SignalBus } from "./signal-bus.js";
export { RunsStore } from "./runs-store.js";
export { SignalStore } from "./signal-store.js";
export type { SignalStoreOptions } from "./signal-store.js";
export type {
  SignalType,
  SignalPayload,
  Signal,
  ProgressPayload,
  FoundPayload,
  BlockedPayload,
  HelpPayload,
  WorkerRunStatus,
  WorkerRun,
  ISignalBus,
  IRunsStore,
  DteamContext,
} from "../tools.js";
