/**
 * P0-原子层：配置定义
 */

export interface WorkerConfig {
  type: "solo" | "chain" | "team";
  task: string;
  style: string;
  options?: WorkerOption[];
  /**
   * LLM 模型字符串，格式 "provider/id"（如 "deepseek/deepseek-chat"）。
   * 留空时 fallback 到 sessionModel，再不行则 fallback 到 dteam 配置默认。
   */
  model?: string;
  /**
   * Fallback 模型链。超过 5 个会被 spawn.ts 截断并 warn。
   */
  fallbackModels?: string[];
  /**
   * 是否启用 git worktree 隔离。
   * 启用后，worker 在独立的 worktree 中执行，避免并行修改冲突。
   */
  worktree?: boolean;
  /**
   * 是否在 worker 完成后自动清理 worktree。
   * 默认 false，保留 worktree 给用户检查。
   */
  worktreeAutoCleanup?: boolean;
}

export type WorkerOption = 
  | { type: "role"; value: string }
  | { type: "steps"; value: ChainStep[] }
  | { type: "workers"; value: Worker[] }
  | { type: "rounds"; value: number }
  | { type: "voting"; value: boolean }
  | { type: "maxDepth"; value: number }
  | { type: "debug"; value: boolean }
  | { type: "concurrency"; value: number }
  | { type: "timeoutMs"; value: number }
  | { type: "concurrencyMode"; value: "static" | "adaptive" }
  | { type: "maxConcurrency"; value: number }
  | { type: "minConcurrency"; value: number };

export type ChainStep = WorkerConfig;
export type Worker = WorkerConfig;

/**
 * 归一化 WorkerConfig.options。
 *
 * Pi 工具 JSON 序列化层可能把数组变成 { item: ... } 或普通对象，
 * 这里统一收敛成 WorkerOption[]，供 P2 入口复用。
 */
export function normalizeOptions(raw: unknown): WorkerOption[] {
  if (raw === undefined || raw === null) return [];
  if (Array.isArray(raw)) return raw as WorkerOption[];
  if (typeof raw !== "object") return [];

  const record = raw as Record<string, unknown>;
  if ("item" in record) {
    const item = record.item;
    if (item === undefined || item === null) return [];
    return Array.isArray(item) ? (item as WorkerOption[]) : [item as WorkerOption];
  }

  return Object.values(record).filter(
    (value): value is WorkerOption => value !== undefined && value !== null,
  );
}

/**
 * 从 options 中获取指定类型的值
 */
export function getOption<T>(options: WorkerOption[] | undefined, type: string): T | undefined {
  if (!options) return undefined;
  const option = options.find(o => o.type === type);
  return option ? (option.value as T) : undefined;
}

/**
 * 从 options 中获取指定类型的值（必填）
 */
export function getRequiredOption<T>(options: WorkerOption[] | undefined, type: string): T {
  const value = getOption<T>(options, type);
  if (value === undefined) {
    throw new Error(`Required option "${type}" not found`);
  }
  return value;
}
