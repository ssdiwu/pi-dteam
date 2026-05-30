/**
 * P0-原子层：配置定义
 */

export interface WorkerConfig {
  type: "solo" | "chain" | "team";
  task: string;
  style: string;
  options?: WorkerOption[];
}

export type WorkerOption = 
  | { type: "role"; value: string }
  | { type: "steps"; value: ChainStep[] }
  | { type: "workers"; value: Worker[] }
  | { type: "rounds"; value: number }
  | { type: "voting"; value: boolean }
  | { type: "maxDepth"; value: number }
  | { type: "debug"; value: boolean }
  | { type: "maxConcurrency"; value: number }
  | { type: "timeoutMs"; value: number };

export type ChainStep = WorkerConfig;
export type Worker = WorkerConfig;

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
