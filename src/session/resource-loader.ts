/**
 * dteam v1 — 最小 ResourceLoader
 *
 * 把 systemPrompt 注入到 createAgentSession 需要的 ResourceLoader。
 * 其他资源（extensions/skills/prompts/themes/agentsFiles）v1 都返回空。
 */

import {
  createExtensionRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

/** 构造 ResourceLoader，getSystemPrompt() 返回传入的 systemPrompt */
export function makeResourceLoader(systemPrompt: string): ResourceLoader {
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
