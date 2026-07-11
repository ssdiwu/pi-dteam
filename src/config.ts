/** dteam 0.7 dispatch 集中配置。 */
export const DTEAM_CONFIG = {
  dispatch: {
    /** 单个 worker prompt 的总超时；超时后 abort 并走模型/T1 回退。 */
    workerTimeoutMs: 60_000,
    /** 单次 fresh worker 最多工具调用次数，防止无界循环。 */
    maxToolRounds: 8,
    /** 超时/取消后等待 worker abort 完成的最长时间，避免无限占用并发槽。 */
    abortGraceMs: 1_000,
  },
} as const;

export type DteamConfig = typeof DTEAM_CONFIG;
