/**
 * dteam — 工具运行时发现
 *
 * 给 planner LLM 用：在制定 ExecutionPlan 时枚举 Pi 当前已加载的所有工具（含内置 + 扩展），
 * 让 LLM 能根据实际可用工具决定每个 step 用哪些。
 *
 * 设计背景：见 doc/工具动态加载方案.md
 * 关联 API：见 doc/扩展API参考.md
 *
 * 为什么不写白名单（fallback chain）：
 *   候选名要人维护 → 面对未来工具不够用。
 *   交给 LLM 决定更灵活（LLM-as-selector）。
 */

import { discoverAndLoadExtensions } from "@earendil-works/pi-coding-agent";

/** 单个工具的简要信息 */
export interface ToolInfo {
  name: string;
  description?: string;
  /** 来自哪个扩展（路径），方便诊断 */
  source: string;
}

/**
 * 枚举 Pi 当前已加载的所有工具。
 * 调 `discoverAndLoadExtensions([], cwd)` 拿全量，再展平 extensions[].tools。
 *
 * 注意：这个调用会走完整的扩展发现链，耗时与 Pi 启动扩展扫描同步；
 * 适合在 planner LLM 路径里调一次，不要在每个 worker session 都调。
 */
export async function listAvailableTools(cwd: string): Promise<ToolInfo[]> {
  const result = await discoverAndLoadExtensions([], cwd);
  const tools: ToolInfo[] = [];
  for (const ext of result.extensions) {
    for (const [name, registered] of ext.tools) {
      const def = registered.definition as { description?: string; name?: string };
      tools.push({
        name,
        description: def.description,
        source: ext.path,
      });
    }
  }
  return tools;
}

/** 格式化为给 LLM 看的清单（`- name: description`，缺 description 时只给 name） */
export function formatToolsForPrompt(tools: ToolInfo[]): string {
  if (tools.length === 0) return "（无）";
  return tools.map(t => t.description ? `- ${t.name}: ${t.description}` : `- ${t.name}`).join("\n");
}
