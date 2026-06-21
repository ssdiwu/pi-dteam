/**
 * dteam v1 — 角色配置（tools / thinking / description）
 *
 * 硬编码 v1 最小集，不依赖 parser。
 * - BASIC_TOOLS：5 角色共有的 5 个基础工具
 * - DTEAM_TOOLS：worker_sendSignal（所有角色）+ reference_architecture
 * - getRoleTools 必须返回 ROLE_DEFAULTS[role].tools 引用本身（测试断言 .toBe()）
 */

import type { RoleName } from "../types/role.js";

/** 角色配置 */
export interface RoleConfig {
  tools: string[];
  thinking: string;
  description: string;
}

/** 5 角色共有的 5 个基础工具（read/bash/grep/find/ls） */
export const BASIC_TOOLS = ["read", "bash", "grep", "find", "ls"];

/** dteam 通用工具：worker_sendSignal（所有角色）+ reference_architecture（仅 design） */
export const DTEAM_TOOLS = ["worker_sendSignal"];
export const DESIGN_TOOLS = ["reference_architecture"];

/** 角色默认配置 */
export const ROLE_DEFAULTS: Record<RoleName, RoleConfig> = {
  explore: {
    tools: [...BASIC_TOOLS, ...DTEAM_TOOLS],
    thinking: "high",
    description: "探索者，搜集内部和外部信息",
  },
  design: {
    tools: [...BASIC_TOOLS.slice(0, 2), "write", ...BASIC_TOOLS.slice(2), ...DTEAM_TOOLS, ...DESIGN_TOOLS],
    thinking: "high",
    description: "方案制定者，评估需求、制定方案",
  },
  build: {
    tools: [...BASIC_TOOLS.slice(0, 2), "edit", "write", ...BASIC_TOOLS.slice(2), ...DTEAM_TOOLS],
    thinking: "high",
    description: "实现者，执行计划、编写代码",
  },
  check: {
    tools: [...BASIC_TOOLS.slice(0, 2), "write", ...BASIC_TOOLS.slice(2), ...DTEAM_TOOLS],
    thinking: "high",
    description: "验收者，检查代码质量、验证结果",
  },
  close: {
    tools: [...BASIC_TOOLS, "write", ...DTEAM_TOOLS],
    thinking: "high",
    description: "收口者，整理归档、记录经验",
  },
};

/** 获取角色的工具列表（返回 ROLE_DEFAULTS 引用本身，测试断言 .toBe） */
export function getRoleTools(role: RoleName): string[] {
  return ROLE_DEFAULTS[role].tools;
}
