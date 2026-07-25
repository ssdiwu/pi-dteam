/** dteam 0.7 模型字符串解析：将 `provider/id` 或裸 id 解析为 Model。 */

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
  }

  // 尝试从 modelRegistry 全量找
  const all = modelRegistry.getAll();
  for (const m of all) {
    if (m.id === modelStr) return m;
  }

  throw new Error(`Cannot resolve model: "${modelStr}"`);
}
