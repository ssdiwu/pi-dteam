import { DISPATCH_BUILT_IN_TOOLS } from "../session/tier-config.js";

export interface ToolPolicy {
  baseTools: string[];
  addTools: string[];
  initialActiveTools: string[];
}

/**
 * 校验本次 worker 的预授权候选工具。
 *
 * 0.8 首个实现仅允许 Pi 内置工具：第三方 extension 必须先经过最小安全加载验证，
 * 不能因 Pi 对未知工具名的静默忽略而被意外当作已授权。
 */
export function createToolPolicy(options: {
  baseTools: readonly string[];
  addTools?: readonly string[];
  parentActiveTools: readonly string[];
  signalToolName: string;
}): ToolPolicy {
  const addTools = [...(options.addTools ?? [])];
  const duplicate = addTools.find((name, index) => addTools.indexOf(name) !== index);
  if (duplicate) throw new Error(`dteam: addTools 包含重复工具 ${duplicate}`);

  const parentActive = new Set(options.parentActiveTools);
  const supported = new Set<string>(DISPATCH_BUILT_IN_TOOLS);
  for (const name of addTools) {
    if (!parentActive.has(name)) {
      throw new Error(`dteam: addTools 工具未获当前主会话授权 ${name}`);
    }
    if (!supported.has(name)) {
      throw new Error(`dteam: addTools 工具尚不支持最小安全加载 ${name}`);
    }
  }

  const baseTools = [...new Set(options.baseTools)];
  const candidates = new Set(addTools);
  const initialActiveTools = [
    ...baseTools,
    options.signalToolName,
  ].filter((name, index, names) => names.indexOf(name) === index);

  return {
    baseTools,
    addTools: [...candidates],
    initialActiveTools,
  };
}

/** 仅允许本次 dispatch 注册过的 addTools 被 request_tools 激活。 */
export function validateRequestedTools(requested: readonly string[], policy: ToolPolicy): string[] {
  if (requested.length === 0) throw new Error("dteam: request_tools 至少需要一个工具");
  const duplicate = requested.find((name, index) => requested.indexOf(name) !== index);
  if (duplicate) throw new Error(`dteam: request_tools 包含重复工具 ${duplicate}`);

  const candidates = new Set(policy.addTools);
  for (const name of requested) {
    if (!candidates.has(name)) {
      throw new Error(`dteam: request_tools 只能申请本次 addTools 候选 ${name}`);
    }
  }
  return [...requested];
}
