/**
 * dteam 0.7 worker session 工厂。
 *
 * 每次 dispatch 创建独立的进程内 AgentSession；档位 prompt、工具白名单与
 * thinking 由调用方或 tier-config 决定。不会继承主会话，也不安装 0.6 信号/角色工具。
 */

import {
  createAgentSession,
  discoverAndLoadExtensions,
  SessionManager,
  SettingsManager,
} from "@earendil-works/pi-coding-agent";
import type { Tier } from "./types/dispatch.js";
import { makeResourceLoader, loadConfiguredPackages } from "./session/resource-loader.js";
import { getTierPrompt, getTierThinking, getTierTools } from "./session/tier-config.js";
import { resolveModelStr } from "./session/model-resolver.js";

/** Session 工厂选项。 */
export interface CreateSessionOptions {
  /** 显式 system prompt（优先于 tier 默认）。 */
  systemPrompt?: string;
  tier?: Tier;
  cwd: string;
  modelStr: string;
  ctx: { modelRegistry?: any };
  /** 覆盖档位默认白名单。 */
  builtInTools?: string[];
  customTools?: any[];
  thinkingLevel?: "off" | "low" | "medium" | "high";
  /** 跳过扩展发现，保持 fresh 的最小 ResourceLoader。 */
  logicalIsolation?: boolean;
}

/** 装配 fresh session；每次使用独立内存 SessionManager。 */
export async function createWorkerSession(options: CreateSessionOptions) {
  const {
    systemPrompt: explicitPrompt,
    tier,
    cwd,
    modelStr,
    ctx,
    builtInTools: explicitTools,
    customTools = [],
    thinkingLevel: explicitThinking,
  } = options;
  const modelRegistry = ctx.modelRegistry;
  if (!modelRegistry) throw new Error("dteam: ctx.modelRegistry not available");

  const systemPrompt = explicitPrompt ?? (tier ? getTierPrompt(tier) : "你是一个助手。请完成任务。");
  const builtInTools = explicitTools ?? (tier ? getTierTools(tier) : []);
  const thinkingLevel = explicitThinking ?? (tier ? getTierThinking(tier) : "off");
  const model = resolveModelStr(modelStr, modelRegistry);
  const resourceLoader = options.logicalIsolation
    ? makeResourceLoader(systemPrompt)
    : makeResourceLoader(systemPrompt, await discoverAndLoadExtensions(loadConfiguredPackages(cwd), cwd));

  const customToolNames = customTools.map((tool: any) => tool.name);
  const activeToolNames = [...builtInTools, ...customToolNames.filter((name) => !builtInTools.includes(name))];
  const { session } = await createAgentSession({
    cwd,
    model,
    thinkingLevel,
    authStorage: modelRegistry.authStorage,
    modelRegistry,
    resourceLoader,
    tools: activeToolNames,
    customTools,
    sessionManager: SessionManager.inMemory(),
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: false },
      retry: { enabled: true, maxRetries: 1 },
    }),
  });
  return session;
}
