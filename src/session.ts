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

// ═══ Session 工厂选项 ═══

export interface CreateSessionOptions {
  /** system prompt */
  systemPrompt: string;
  /** 工作目录 */
  cwd: string;
  /** 模型字符串，如 "zai/glm-5.1" 或 "minimax-cn/MiniMax-M3" */
  modelStr: string;
  /** Pi 扩展上下文（拿 modelRegistry / authStorage） */
  ctx: any;
  /** 可选：暴露给 LLM 的工具列表 */
  tools?: any[];
  /** 可选：thinking level，默认 "off" */
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
    systemPrompt,
    cwd,
    modelStr,
    ctx,
    tools,
    thinkingLevel = "off",
  } = options;

  const modelRegistry = ctx.modelRegistry;
  if (!modelRegistry) throw new Error("dteam: ctx.modelRegistry not available");

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
    tools: tools ?? [],
    sessionManager: SessionManager.inMemory(),
    settingsManager,
  });

  return session;
}
