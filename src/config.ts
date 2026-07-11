/** dteam 0.7 dispatch 集中配置。 */
export const DTEAM_CONFIG = {
  dispatch: {
    /** 单个 worker prompt 的总超时；超时后 abort 并走模型/T1 回退。 */
    workerTimeoutMs: 60_000,
    /** 单次 fresh worker 最多工具调用次数，防止无界循环。 */
    maxToolRounds: 8,
  },
} as const;

export type DteamConfig = typeof DTEAM_CONFIG;
