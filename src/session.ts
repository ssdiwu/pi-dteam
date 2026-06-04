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
import { resolve, dirname } from "node:path";
import type { RoleName, DteamContext } from "./tools.js";
import { referenceArchitectureTool } from "./reference-data.js";

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

/** 角色配置 */
interface RoleConfig {
  tools: string[];
  thinking: string;
  description: string;
}

// 角色默认配置（硬编码 v1 最小集，不依赖 parser）
// 包含 worker_sendSignal（所有角色都可以发信号）和 reference_architecture（design 角色可用）
const DTEAM_TOOLS = ["worker_sendSignal", "reference_architecture"];

const ROLE_DEFAULTS: Record<RoleName, RoleConfig> = {
  explore: {
    tools: ["read", "bash", "grep", "find", "ls", "tinyfish_search", "tinyfish_fetch", ...DTEAM_TOOLS],
    thinking: "high",
    description: "探索者，搜集内部和外部信息",
  },
  design: {
    tools: ["read", "bash", "write", "grep", "find", "ls", ...DTEAM_TOOLS],
    thinking: "high",
    description: "方案制定者，评估需求、制定方案",
  },
  build: {
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", ...DTEAM_TOOLS],
    thinking: "high",
    description: "实现者，执行计划、编写代码",
  },
  check: {
    tools: ["read", "bash", "write", "grep", "find", "ls", ...DTEAM_TOOLS],
    thinking: "high",
    description: "验收者，检查代码质量、验证结果",
  },
  close: {
    tools: ["read", "bash", "grep", "find", "ls", "write", ...DTEAM_TOOLS],
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
  /** dteam 信号通路上下文（注入 worker_sendSignal 工具） */
  dteamContext?: DteamContext;
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

// ═══ 信号工具工厂 ═══

/** 创建 worker_sendSignal customTool（闭包捕获 dteamContext） */
function makeWorkerSendSignalTool(dteamCtx: DteamContext) {
  return {
    name: "worker_sendSignal",
    label: "worker_sendSignal",
    description:
      "向主编排器上报信号。4 种类型：progress（进度）、found（发现）、blocked（阻塞）、help（求助）。",
    parameters: {
      type: "object" as const,
      properties: {
        signalType: {
          type: "string" as const,
          enum: ["progress", "found", "blocked", "help"],
          description: "信号类型",
        },
        data: {
          type: "object" as const,
          description: "信号 payload（根据 signalType 填写对应字段）",
        },
      },
      required: ["signalType", "data"],
    },
    async execute(
      _toolCallId: string,
      params: { signalType: string; data: any },
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      const { signalType, data } = params;
      const signal = {
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: signalType as import("./tools.js").SignalType,
        workerId: dteamCtx.workerId,
        runId: dteamCtx.runId,
        timestamp: Date.now(),
        data,
      };
      dteamCtx.signalBus.emit(signal);
      try {
        dteamCtx.runsStore.appendSignal(dteamCtx.runId, dteamCtx.workerId, signal);
      } catch {
        // worker 不在 runs 中，忽略
      }
      return {
        content: [{ type: "text" as const, text: `信号已记录: ${signal.id} (${signalType})` }],
      };
    },
  };
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
    dteamContext,
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
    customTools: [
      ...(customToolsArg ?? []),
      ...(dteamContext ? [makeWorkerSendSignalTool(dteamContext)] : []),
      ...(role === "design" ? [referenceArchitectureTool] : []),
    ],
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  return session;
}
