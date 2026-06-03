/**
 * P0-原子层：并发控制
 *
 * 限制同时执行的 Promise 数量，避免资源耗尽
 */

/**
 * 并发映射：限制同时执行的 Promise 数量
 *
 * @param items 输入数组
 * @param concurrency 最大并发数
 * @param fn 映射函数
 * @returns 结果数组（顺序与输入一致）
 */
export async function mapWithConcurrencyLimit<TIn, TOut>(
  items: TIn[],
  concurrency: number,
  fn: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results: TOut[] = new Array(items.length);
  let nextIndex = 0;
  const workers = new Array(limit).fill(null).map(async () => {
    while (true) {
      const current = nextIndex++;
      if (current >= items.length) return;
      results[current] = await fn(items[current], current);
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * 超时控制：为 Promise 添加超时
 *
 * @param promise 原始 Promise
 * @param timeoutMs 超时时间（毫秒）
 * @param timeoutMessage 超时消息
 * @returns 带超时的 Promise
 */
export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  timeoutMessage: string = "Operation timed out",
): Promise<T> {
  let timeoutId: NodeJS.Timeout;

  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(timeoutMessage));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeoutPromise]);
    clearTimeout(timeoutId!);
    return result;
  } catch (error) {
    clearTimeout(timeoutId!);
    throw error;
  }
}
