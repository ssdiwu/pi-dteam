/**
 * dteam v1 — Agent Session 工厂
 *
 * 统一创建 AgentSession，brancher / leaf / 未来的 worker 都走这里。
 * 解决 API key 解析、model 解析、ResourceLoader 等底层问题。
 */

import {
  createAgentSession,
  createExtensionRuntime,
  SessionManager,
  SettingsManager,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve, dirname } from "node:path";

// ═══ 最小 ResourceLoader ═══

function makeResourceLoader(systemPrompt: string): ResourceLoader {
  return {
    getExtensions: () => ({ extensions: [], errors: [], runtime: createExtensionRuntime() }),
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => systemPrompt,
    getAppendSystemPrompt: () => [],
    extendResources: () => {},
    reload: async () => {},
  };
}

// ═══ 角色定义 ═══

export type RoleName = "explore" | "design" | "build" | "check" | "close";

/** 角色配置（从 agents/*.md frontmatter 解析） */
interface RoleConfig {
  tools: string[];
  thinking: string;
  description: string;
}

// 角色默认配置（硬编码 v1 最小集，不依赖 parser）
const ROLE_DEFAULTS: Record<RoleName, RoleConfig> = {
  explore: {
    tools: ["read", "bash", "grep", "find", "ls"],
    thinking: "high",
    description: "探索者，搜集内部和外部信息",
  },
  design: {
    tools: ["read", "bash", "grep", "find", "ls"],
    thinking: "high",
    description: "方案制定者，评估需求、制定方案",
  },
  build: {
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls"],
    thinking: "high",
    description: "实现者，执行计划、编写代码",
  },
  check: {
    tools: ["read", "bash", "grep", "find", "ls"],
    thinking: "high",
    description: "验收者，检查代码质量、验证结果",
  },
  close: {
    tools: ["read", "bash", "grep", "find", "ls", "write"],
    thinking: "high",
    description: "收口者，整理归档、记录经验",
  },
};

/** 获取角色的 systemPrompt（从 agents/*.md 读取 body 部分） */
function loadRolePrompt(role: RoleName, cwd: string): string {
  // 尝试从 agents/ 目录加载
  const candidates = [
    resolve(cwd, "agents", `${role}.md`),
    resolve(process.cwd(), "agents", `${role}.md`),
  ];
  for (const path of candidates) {
    try {
      const raw = readFileSync(path, "utf-8");
      // 去掉 frontmatter（--- ... ---）
      const body = raw.replace(/^---[\s\S]*?---\s*/, "").trim();
      if (body) return body;
    } catch { /* try next */ }
  }
  // fallback：角色名 + 描述
  const cfg = ROLE_DEFAULTS[role];
  return `你是 dteam 的 ${role}（${cfg.description}）。请完成分配给你的任务。`;
}

/** 获取角色的工具列表 */
export function getRoleTools(role: RoleName): string[] {
  return ROLE_DEFAULTS[role].tools;
}

// ═══ Session 工厂选项 ═══

export interface CreateSessionOptions {
  /** system prompt（直接指定时优先） */
  systemPrompt?: string;
  /** 角色名（和 systemPrompt 二选一） */
  role?: RoleName;
  /** 工作目录 */
  cwd: string;
  /** 模型字符串，如 "zai/glm-5.1" 或 "minimax-cn/MiniMax-M3" */
  modelStr: string;
  /** Pi 扩展上下文（拿 modelRegistry / authStorage） */
  ctx: any;
  /** 内置工具名字列表（覆盖角色默认工具） */
  builtInTools?: string[];
  /** 自定义工具定义，如 brancher 的 decide 工具 */
  customTools?: any[];
  /** 可选：thinking level，默认从角色配置取 */
  thinkingLevel?: "off" | "low" | "medium" | "high";
}

// ═══ 解析 model 字符串 → Model 对象 ═══

function resolveModelStr(
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
      return getModel(provider as any, id as any);
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

// ═══ 主工厂函数 ═══

export async function createWorkerSession(options: CreateSessionOptions) {
  const {
    systemPrompt: explicitPrompt,
    role,
    cwd,
    modelStr,
    ctx,
    builtInTools: explicitTools,
    customTools: customToolsArg,
    thinkingLevel: explicitThinking,
  } = options;

  const modelRegistry = ctx.modelRegistry;
  if (!modelRegistry) throw new Error("dteam: ctx.modelRegistry not available");

  // 角色 vs 显式 systemPrompt
  const systemPrompt = explicitPrompt ?? (role ? loadRolePrompt(role, cwd) : "你是一个助手。请完成任务。");
  const builtInTools = explicitTools ?? (role ? getRoleTools(role) : []);
  const thinkingLevel = explicitThinking ?? (role ? (ROLE_DEFAULTS[role].thinking as any) : "off");

  const model = resolveModelStr(modelStr, modelRegistry);
  const resourceLoader = makeResourceLoader(systemPrompt);

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel,
    authStorage: modelRegistry.authStorage,
    modelRegistry,
    resourceLoader,
    tools: builtInTools,
    customTools: customToolsArg,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  return session;
}
