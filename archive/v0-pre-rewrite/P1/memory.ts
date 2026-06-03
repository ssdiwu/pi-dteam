/**
 * 共享内存工具
 *
 * 提供共享内存的读写接口
 */

import { memory } from "../P2/worker.js";
import { resolveDteamMemoryPath } from "../P0/pathSafety.js";

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * memory_get — 从共享内存获取值
 */
export async function memoryGet(
  ctx: { cwd: string },
  params: { namespace: string; key: string },
): Promise<{ content: string }> {
  const { namespace, key } = params;
  const value = memory.get(namespace, key);

  return {
    content: JSON.stringify({
      namespace,
      key,
      value,
      message: value !== undefined ? `Found: ${namespace}.${key}` : `Not found: ${namespace}.${key}`,
    }),
  };
}

/**
 * memory.set — 向共享内存设置值
 */
export async function memorySet(
  ctx: { cwd: string },
  params: { namespace: string; key: string; value: unknown; agentId: string },
): Promise<{ content: string }> {
  const { namespace, key, value, agentId } = params;
  memory.set(namespace, key, value, agentId);

  return {
    content: JSON.stringify({
      namespace,
      key,
      message: `Set: ${namespace}.${key}`,
    }),
  };
}

/**
 * memory.keys — 列出命名空间下的所有键
 */
export async function memoryKeys(
  ctx: { cwd: string },
  params: { namespace: string },
): Promise<{ content: string }> {
  const { namespace } = params;
  const keys = memory.keys(namespace);

  return {
    content: JSON.stringify({
      namespace,
      keys,
      message: `Found ${keys.length} keys in namespace: ${namespace}`,
    }),
  };
}

/**
 * memory.has — 检查键是否存在
 */
export async function memoryHas(
  ctx: { cwd: string },
  params: { namespace: string; key: string },
): Promise<{ content: string }> {
  const { namespace, key } = params;
  const exists = memory.has(namespace, key);

  return {
    content: JSON.stringify({
      namespace,
      key,
      exists,
      message: exists ? `Exists: ${namespace}.${key}` : `Not exists: ${namespace}.${key}`,
    }),
  };
}

/**
 * memory.delete — 删除键
 */
export async function memoryDelete(
  ctx: { cwd: string },
  params: { namespace: string; key: string },
): Promise<{ content: string }> {
  const { namespace, key } = params;
  const deleted = memory.delete(namespace, key);

  return {
    content: JSON.stringify({
      namespace,
      key,
      deleted,
      message: deleted ? `Deleted: ${namespace}.${key}` : `Not found: ${namespace}.${key}`,
    }),
  };
}

/**
 * memory.clear — 清空命名空间
 */
export async function memoryClear(
  ctx: { cwd: string },
  params: { namespace: string },
): Promise<{ content: string }> {
  const { namespace } = params;
  memory.clear(namespace);

  return {
    content: JSON.stringify({
      namespace,
      message: `Cleared namespace: ${namespace}`,
    }),
  };
}

/**
 * memory.save — 保存共享内存到文件
 */
export async function memorySave(
  ctx: { cwd: string },
  params: { filepath: string },
): Promise<{ content: string }> {
  const { filepath } = params;

  try {
    await memory.save(resolveDteamMemoryPath(ctx.cwd, filepath));
    return {
      content: JSON.stringify({
        filepath,
        message: `Memory saved to: ${filepath}`,
      }),
    };
  } catch (error) {
    return {
      content: JSON.stringify({
        error: (error as Error).message,
        message: `Failed to save memory`,
      }),
    };
  }
}

/**
 * memory.load — 从文件加载共享内存
 */
export async function memoryLoad(
  ctx: { cwd: string },
  params: { filepath: string },
): Promise<{ content: string }> {
  const { filepath } = params;

  try {
    await memory.load(resolveDteamMemoryPath(ctx.cwd, filepath));
    return {
      content: JSON.stringify({
        filepath,
        namespaces: memory.namespaces(),
        message: `Memory loaded from: ${filepath}`,
      }),
    };
  } catch (error) {
    return {
      content: JSON.stringify({
        error: (error as Error).message,
        message: `Failed to load memory`,
      }),
    };
  }
}
