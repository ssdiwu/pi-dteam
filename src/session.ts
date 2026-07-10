/**
 * dteam v1 — Agent Session 工厂（thin coordinator）
 *
 * 0.7/0.6 过渡期职责拆到 src/session/ 子模块，本文件只做 import + 装配：
 *  - tier-config     : T1/T2/T3 默认 thinking / tools / prompt（0.7 主路径）
 *  - resource-loader : makeResourceLoader
 *  - role-config / role-prompt / signal-tool：0.6 loop 过渡兼容，待删除
 *  - model-resolver  : resolveModelStr / pickAvailableModel
 */

import {
  createAgentSession,
  discoverAndLoadExtensions,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { DteamContext } from "./types/context.js";
import type { Tier } from "./types/dispatch.js";
import type { RoleName } from "./types/role.js";
import { referenceArchitectureTool } from "./reference-data.js";
import { makeResourceLoader, loadConfiguredPackages } from "./session/resource-loader.js";
import { ROLE_DEFAULTS, getRoleTools } from "./session/role-config.js";
import { getTierPrompt, getTierThinking, getTierTools } from "./session/tier-config.js";
import { loadRolePrompt } from "./session/role-prompt.js";
import { resolveModelStr, pickAvailableModel } from "./session/model-resolver.js";
import { makeWorkerSendSignalTool } from "./session/signal-tool.js";

/** Session 工厂选项 */
export interface CreateSessionOptions {
  systemPrompt?: string;          // 显式 systemPrompt（优先于 tier / role）
  tier?: Tier;                    // 0.7 模型档位（与旧 role 二选一）
  role?: RoleName;                // 0.6 角色名（旧 loop 退场前兼容）
  cwd: string;                    // 工作目录
  modelStr: string;               // 模型字符串 "provider/id"
  ctx: any;                       // Pi 扩展上下文（modelRegistry / authStorage）
  builtInTools?: string[];        // 内置工具列表（覆盖角色默认）
  customTools?: any[];            // 自定义工具（brancher decide 等）
  dteamContext?: DteamContext;    // dteam 信号通路上下文
  thinkingLevel?: "off" | "low" | "medium" | "high"; // 思考等级
  /** 0.6.0 Logical Isolation：为 true 时跳过扩展发现，worker session 保持 fresh（不继承主会话扩展工具） */
  logicalIsolation?: boolean;
  /** 0.6.0：worker session 创建后回调，供调用方挂 session.subscribe 实时采集信号（双通道） */
  onSession?: (session: any) => void;
}

// 保持外部 API 兼容：planner/brancher/leaf 都从 ./session.js 拿
export { getRoleTools, pickAvailableModel };

/** 主工厂：装配 resourceLoader + tools + customTools，调 createAgentSession */
export async function createWorkerSession(options: CreateSessionOptions) {
  const { systemPrompt: explicitPrompt, tier, role, cwd, modelStr, ctx,
    builtInTools: explicitTools, customTools: customToolsArg,
    dteamContext, thinkingLevel: explicitThinking } = options;

  const modelRegistry = ctx.modelRegistry;
  if (!modelRegistry) throw new Error("dteam: ctx.modelRegistry not available");

  const systemPrompt = explicitPrompt
    ?? (tier ? getTierPrompt(tier) : role ? loadRolePrompt(role, cwd) : "你是一个助手。请完成任务。");
  const builtInTools = explicitTools
    ?? (tier ? getTierTools(tier) : role ? getRoleTools(role) : []);
  const thinkingLevel = explicitThinking
    ?? (tier ? getTierThinking(tier) : role ? (ROLE_DEFAULTS[role].thinking as any) : "off");

  const model = resolveModelStr(modelStr, modelRegistry);
  // 0.6.0 Logical Isolation：可选跳过扩展发现，worker session 保持 fresh
  // （不继承主会话扩展工具，只载角色 prompt + 工具白名单）
  const resourceLoader = options.logicalIsolation
    ? makeResourceLoader(systemPrompt)
    : makeResourceLoader(systemPrompt, await discoverAndLoadExtensions(loadConfiguredPackages(cwd), cwd));

  const settingsManager = SettingsManager.inMemory({
    compaction: { enabled: false },
    retry: { enabled: true, maxRetries: 1 },
  });

  // 0.6.0：收集所有 customTools（包括注入的 sendSignal/reference_architecture/决策工具）
  const resolvedCustomTools = [
    ...(customToolsArg ?? []),
    ...(dteamContext ? [makeWorkerSendSignalTool(dteamContext)] : []),
    ...(role === "design" ? [referenceArchitectureTool] : []),
  ];
  // customTools 的 name 必须并入 tools 白名单，否则 Pi SDK 不会激活它们（LLM 看不到）
  const customToolNames = resolvedCustomTools.map((t: any) => t.name);
  const activeToolNames = [...builtInTools, ...customToolNames.filter(n => !builtInTools.includes(n))];

  const { session } = await createAgentSession({
    cwd, model, thinkingLevel,
    authStorage: modelRegistry.authStorage,
    modelRegistry, resourceLoader,
    tools: activeToolNames,
    customTools: resolvedCustomTools,
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  // 0.6.0：session 创建后回调，供调用方挂 session.subscribe（双通道信号采集）
  if (options.onSession) {
    try { options.onSession(session); } catch { /* 回调失败不影响 session */ }
  }

  return session;
}
