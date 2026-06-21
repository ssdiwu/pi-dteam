/**
 * dteam v1 — 集中配置
 *
 * 所有 magic number / 路径 / 超时统一从 DTEAM_CONFIG 取。
 * 后续可被 ctx.config 覆盖。
 *
 * 【重构方案】Phase 1 - E：解决 O-7 + L-2 散落常量
 */

export const DTEAM_CONFIG = {
  /** team/parallel 模式：每批最多并行几个 worker */
  team: {
    batchSize: 3,
  },
  /** build_check 策略：build → check → 修 → 再 check 最多几轮 */
  buildCheck: {
    maxRounds: 3,
  },
  /** adaptive 策略：执行 → 评估 → 调整 → 再评估 最多几轮 */
  adaptive: {
    maxRounds: 5,
  },
  /** 叶子（leaf）行为 */
  leaf: {
    /** 同一叶子最多能发几次 help（自愈/升级） */
    maxHelpRounds: 3,
    /** help 自愈/根注入的超时（毫秒），超过则 resolve(null) 让叶子退出循环 */
    supplementTimeoutMs: 60_000,
    /** 单次 prompt 内最多工具调用次数；超过则 abort 中断 worker，防慢模型死循环 */
    maxToolRounds: 8,
  },
  /** 0.5.0 scheduler：轻量依赖图与 preflight 调度 */
  scheduler: {
    /** import graph 首版只扫描这些扩展名 */
    supportedExtensions: [".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs"] as string[],
    /** 单次 run 最多扫描文件数，避免误扫整个仓库 */
    maxScanFiles: 200,
    /** shared file patterns：涉及这些文件时更保守地拆批 */
    sharedFilePatterns: [
      "package.json",
      "package-lock.json",
      "pnpm-lock.yaml",
      "yarn.lock",
      "tsconfig.json",
      "vitest.config.*",
      "index.ts",
    ] as string[],
  },
  /** agent 提示词/role config 查找路径（按顺序找） */
  agentPaths: ["agents"] as string[],
} as const;

export type DteamConfig = typeof DTEAM_CONFIG;
