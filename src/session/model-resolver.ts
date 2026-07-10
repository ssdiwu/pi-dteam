/**
 * dteam v1 — model 字符串解析
 *
 * - resolveModelStr：把 "provider/id" 或裸 id 解析成 modelRegistry / getModel 中的 Model 对象
 * - pickAvailableModel：公开 API，输出可用的 "provider/id" 字符串（primary → fallback → ctx.model）
 */

import { getModel } from "@earendil-works/pi-ai";

/** 解析 model 字符串 → Model 对象 */
export function resolveModelStr(
  modelStr: string,
  modelRegistry: any,
): any {
  // 尝试 "provider/modelId" 格式
  const slashIdx = modelStr.indexOf("/");
  if (slashIdx > 0) {
    const provider = modelStr.slice(0, slashIdx);
    const id = modelStr.slice(slashIdx + 1);
    const found = modelRegistry.find(provider, id);
    if (found) return found;
    try {
      const resolved = getModel(provider as any, id as any);
      if (resolved) return resolved;
    } catch {
      // fall through
    }
  }

  // 尝试从 modelRegistry 全量找
  const all = modelRegistry.getAll();
  for (const m of all) {
    if (m.id === modelStr) return m;
  }

  throw new Error(`Cannot resolve model: "${modelStr}"`);
}

/**
 * 公开：解析当前可用的 model 字符串。
 *
 * 优先级：
 *  1. 显式 primary：按原逻辑尝试 primary → fallback
 *  2. 不传 primary/fallback：默认从 ctx.model 转字符串（会话同个模型）
 *
 * 返回实际能用的 model 字符串（"provider/id" 格式）。
 */
export function pickAvailableModel(
  ctx: any,
  primary?: string,
  fallback?: string,
): string {
  const registry = ctx?.modelRegistry;

  // 1. 显式 primary：尝试 primary → fallback
  if (primary) {
    for (const m of [primary, fallback]) {
      if (!m) continue;
      const slashIdx = m.indexOf("/");
      if (slashIdx <= 0) continue;
      const provider = m.slice(0, slashIdx);
      const id = m.slice(slashIdx + 1);
      if (registry?.find?.(provider, id)) {
        if (m !== primary) {
          console.error(`[dteam] Primary model ${primary} not found, falling back to ${m}`);
        }
        return m;
      }
    }
    return primary; // 都找不到，让 resolveModelStr 拋错
  }

  // 2. 默认从 ctx.model 转字符串
  const m = ctx?.model;
  if (!m?.provider || !m?.id) {
    throw new Error("dteam: no model in ctx (and no primary/fallback given)");
  }
  return `${m.provider}/${m.id}`;
}
