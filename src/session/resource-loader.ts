/**
 * dteam v1 — ResourceLoader
 *
 * 把 systemPrompt 注入到 createAgentSession 需要的 ResourceLoader。
 * 0.4.1 改进：支持传入已发现的扩展，使 worker session 能用扩展工具（如 tinyfish）。
 * 其他资源（skills/prompts/themes/agentsFiles）v1 仍返回空。
 */

import { existsSync, readFileSync } from "fs";
import { isAbsolute, join, resolve } from "path";
import { homedir } from "os";

import {
  createExtensionRuntime,
  type ResourceLoader,
} from "@earendil-works/pi-coding-agent";

/**
 * 从 `~/.pi/agent/settings.json` 的 `packages` 字段读出本地路径形式的扩展。
 * 用于走 `discoverAndLoadExtensions(configuredPaths, ...)` 加载
 * （npm: / git: 前缀的包走不到这里，交给默认发现机制去处理）。
 *
 * 0.4.1 新增：解决 worker session 拿不到主会话自定义路径加载的扩展的问题。
 * 关键：pi 加载 packages 时读 package.json 的 `pi.extensions` 字段得扩展入口；
 * 这里复刻这个机制，探到包根目录后读 pi.extensions 数组。
 */
export function loadConfiguredPackages(
  cwd: string,
  agentDir: string = join(homedir(), ".pi", "agent"),
): string[] {
  const settingsPath = join(agentDir, "settings.json");
  let settings: any;
  try {
    settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
  } catch {
    return [];
  }
  const packages: unknown[] = Array.isArray(settings?.packages) ? settings.packages : [];
  return packages
    .filter((p: unknown): p is string => typeof p === "string")
    .filter(p => !p.startsWith("npm:") && !p.startsWith("git:") && !p.startsWith("http"))
    .map(p => (isAbsolute(p) ? p : resolve(cwd, p)))
    .filter(p => existsSync(p))
    .map(p => resolvePackageExtensions(p))
    .flat()
    .filter(p => existsSync(p));
}

/**
 * 从一个 pi package 根路径解析出它实际包含的扩展入口。
 * 复刻 pi 主会话加载 packages 的逻辑：读 package.json 的 `pi.extensions`，
 * 拿到 ["./extensions", "./extensions/extra"] 这种。
 * 找不到 pi 字段则 fallback 到 `extensions/index.ts`。
 */
function resolvePackageExtensions(pkgRoot: string): string[] {
  const pkgJsonPath = join(pkgRoot, "package.json");
  let entries: string[] = [];
  try {
    const pkg = JSON.parse(readFileSync(pkgJsonPath, "utf-8"));
    const piField = pkg?.pi;
    if (Array.isArray(piField?.extensions)) {
      entries = piField.extensions.filter((e: unknown): e is string => typeof e === "string");
    } else if (typeof piField?.extensions === "string") {
      entries = [piField.extensions];
    }
  } catch {
    // package.json 读不到 → fallback
  }
  if (entries.length === 0) {
    // fallback：传统约定 `extensions/index.ts`
    const fallback = join(pkgRoot, "extensions", "index.ts");
    if (existsSync(fallback)) entries = ["./extensions/index.ts"];
  }
  return entries.map(e => resolve(pkgRoot, e));
}

/**
 * 构造 ResourceLoader。
 *
 * @param systemPrompt 注入到 getSystemPrompt()
 * @param extensionsResult 可选：已发现的扩展列表。
 *   - 不传（v0.4.0 行为）：返回空扩展 → worker 只有内置工具
 *   - 传入：worker session 能用扩展工具（如 tinyfish_search）
 */
export function makeResourceLoader(
  systemPrompt: string,
  extensionsResult?: { extensions: any[]; errors: any[]; runtime: any },
): ResourceLoader {
  const ext = extensionsResult ?? { extensions: [], errors: [], runtime: createExtensionRuntime() };
  return {
    getExtensions: () => ext,
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
