/**
 * dteam v1 — dteam 信号通路上下文
 *
 * 把 SignalBus / RunsStore / runId / workerId / 补充队列 / 注入队列
 * 打包成一个 context，便于在 orchestrator / leaf / session 之间传递。
 */

import type { ISignalBus, IRunsStore } from "./run.js";

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
