/** dteam 0.8 runtime 集中配置。 */
export const DTEAM_CONFIG = {
  dispatch: {
    /** 每次 worker attempt 的默认总预算（内部使用毫秒）；超时后 abort 并请求主代理 timeout recovery。 */
    workerTimeoutMs: 300_000,
    /** 每个 worker 按初始档位获得的工作工具调用额度；dteam_signal 与 dteam_report 不计入。 */
    toolCallBudgetByTier: { T1: 180, T2: 120, T3: 60 },
    /** 主代理一次可批准的额外工作工具调用额度。 */
    toolCallBudgetExtension: { min: 60, max: 120, step: 10, maxPerWorker: 1 },
    /** 超时/取消后等待 worker abort 完成的最长时间，避免无限占用并发槽。 */
    abortGraceMs: 1_000,
    /** 同一 worker 在当前 Pi 会话内最多请求几次 timeout recovery。 */
    maxTimeoutRecoveries: 2,
    /** timeout recovery 在当前会话内所有 fresh attempt 的累计预算上限；不改变每次 attempt 的五分钟默认预算。 */
    maxRecoveryBudgetMs: 600_000,
    /** 传给 fresh recovery attempt 的恢复摘要最大字符数。 */
    maxRecoverySummaryChars: 4_000,
    /** 有界 handoff 的上限，避免跨档交接膨胀或注入整段会话。 */
    maxHandoffFacts: 24,
    maxHandoffItems: 12,
    maxHandoffFieldChars: 1_000,
    maxHandoffChars: 4_000,
    /** dteam_wait 单次等待上限；超时只返回部分状态，不取消 worker。 */
    maxWaitMs: 300_000,
  },
} as const;

export type DteamConfig = typeof DTEAM_CONFIG;
