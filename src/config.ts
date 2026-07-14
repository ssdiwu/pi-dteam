/** dteam 0.8 runtime 集中配置。 */
export const DTEAM_CONFIG = {
  dispatch: {
    /** 每次 worker attempt 的默认总预算（内部使用毫秒）；超时后 abort 并请求主代理 timeout recovery。 */
    workerTimeoutMs: 300_000,
    /** 单次 fresh worker 最多工具调用次数，防止无界循环。 */
    maxToolRounds: 8,
    /** 超时/取消后等待 worker abort 完成的最长时间，避免无限占用并发槽。 */
    abortGraceMs: 1_000,
    /** 同一 worker 在当前 Pi 会话内最多请求几次 timeout recovery。 */
    maxTimeoutRecoveries: 2,
    /** timeout recovery 在当前会话内所有 fresh attempt 的累计预算上限；不改变每次 attempt 的五分钟默认预算。 */
    maxRecoveryBudgetMs: 600_000,
    /** 传给 fresh recovery attempt 的恢复摘要最大字符数。 */
    maxRecoverySummaryChars: 4_000,
  },
} as const;

export type DteamConfig = typeof DTEAM_CONFIG;
