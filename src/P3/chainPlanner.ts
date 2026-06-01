/**
 * P3-组织层：task Markdown → chain plan 解析器
 *
 * 读取 task Markdown 文件，提取元数据、目标、验收条件，
 * 根据 task 类型选择默认链模板，生成 ChainPlan。
 */

import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

// ── 类型定义 ──────────────────────────────────────────────────

/** chain plan 中的单步 */
export interface ChainStep {
  /** 角色名（explore/design/build/check/close） */
  role: string;
  /** 执行模式 */
  mode: "solo" | "team" | "chain";
  /** 该步骤的任务描述 */
  task: string;
  /** 依赖的前序步骤角色列表 */
  dependsOn?: string[];
}

/** 完整的 chain plan */
export interface ChainPlan {
  /** 来源 task id */
  taskId: string;
  /** task 类型 */
  taskType: string;
  /** chain 步骤列表 */
  steps: ChainStep[];
}

// ── 角色默认链模板 ─────────────────────────────────────────────

/** 按 task 类型定义默认的角色链 */
const DEFAULT_CHAINS: Record<string, readonly string[]> = {
  refactor: ["explore", "design", "build", "check", "close"],
  bugfix: ["explore", "build", "check", "close"],
  infra: ["explore", "design", "build", "check", "close"],
  functional: ["explore", "build", "check", "close"],
  ui: ["explore", "design", "build", "check", "close"],
};

/** fallback 链：当 task 类型不在已知列表时使用 */
const FALLBACK_CHAIN: readonly string[] = ["explore", "build", "check", "close"];

// ── Markdown 解析工具 ──────────────────────────────────────────

/** 判断标题是否匹配指定 section */
function isSectionMatch(title: string, section: string): boolean {
  return title === section || title.startsWith(`${section}（`) || title.startsWith(`${section}(`);
}

/** 查找 section 的文本范围 */
function findSectionRange(
  content: string,
  section: string,
): { bodyStart: number; end: number } | null {
  const headingRegex = /^##\s+(.+)$/gm;
  let match: RegExpExecArray | null;
  let target: { bodyStart: number } | null = null;

  while ((match = headingRegex.exec(content)) !== null) {
    if (target) {
      return { bodyStart: target.bodyStart, end: match.index };
    }
    const title = match[1].trim();
    if (isSectionMatch(title, section)) {
      target = { bodyStart: headingRegex.lastIndex };
    }
  }

  return target ? { bodyStart: target.bodyStart, end: content.length } : null;
}

/** 提取指定 section 的内容 */
function extractSection(content: string, section: string): string {
  const range = findSectionRange(content, section);
  if (!range) return "";
  return content.slice(range.bodyStart, range.end).trim();
}

/** 从 task 文件名提取 task id */
function extractTaskId(filename: string): string {
  const match = filename.match(/(\d{14}-[a-z0-9]{4})/);
  return match ? match[1] : filename.replace(/\.md$/, "");
}

/** 从 task 内容提取类型 */
function extractTaskType(content: string): string {
  const match = content.match(/类型:\s*(\w+)/);
  return match ? match[1] : "unknown";
}

/** 从「目标」section 提取「做什么」 */
function extractGoal(content: string): string {
  const goalSection = extractSection(content, "目标");
  const match = goalSection.match(/做什么:\s*(.+)$/m);
  return match ? match[1].trim() : "";
}

/** 从「验收条件」section 提取 checklist 项 */
function extractAcceptanceCriteria(content: string): string[] {
  const acSection = extractSection(content, "验收条件");
  if (!acSection) return [];

  const items: string[] = [];
  const lineRegex = /- \[[ x]\]\s*(.+)$/gm;
  let match: RegExpExecArray | null;

  while ((match = lineRegex.exec(acSection)) !== null) {
    items.push(match[1].trim());
  }

  return items;
}

// ── 核心：生成 ChainPlan ───────────────────────────────────────

/**
 * 从 task Markdown 内容生成 ChainPlan。
 *
 * @param content - task 文件的完整 Markdown 文本
 * @param filename - 文件名（用于提取 taskId）
 * @returns ChainPlan
 */
export function generatePlan(content: string, filename: string): ChainPlan {
  const taskId = extractTaskId(filename);
  const taskType = extractTaskType(content);
  const goal = extractGoal(content);
  const criteria = extractAcceptanceCriteria(content);

  // 选择链模板
  const chain = DEFAULT_CHAINS[taskType] ?? FALLBACK_CHAIN;

  // 为每个 step 生成 task 描述
  const steps: ChainStep[] = chain.map((role, i) => {
    const roleTask = buildStepTask(role, goal, criteria);
    const step: ChainStep = {
      role,
      mode: "solo",
      task: roleTask,
    };

    // 串行依赖：除第一步外，都依赖前一步
    if (i > 0) {
      step.dependsOn = [chain[i - 1]];
    }

    return step;
  });

  return { taskId, taskType, steps };
}

/**
 * 为单个 step 生成任务描述。
 * 优先从验收条件中匹配该角色相关的内容，否则用默认描述。
 */
function buildStepTask(role: string, goal: string, criteria: string[]): string {
  // 尝试从验收条件中找与该角色相关的条目
  const roleCriteria = criteria.filter((c) =>
    c.toLowerCase().includes(role.toLowerCase()),
  );

  if (roleCriteria.length > 0) {
    return `[${role}] ${roleCriteria.join("; ")}`;
  }

  // 使用默认的角色描述
  const defaults: Record<string, string> = {
    explore: `[explore] 探索现状，理解需求：${goal}`,
    design: `[design] 设计方案，明确接口和边界：${goal}`,
    build: `[build] 编码实现，遵循现有代码风格：${goal}`,
    deploy: `[deploy] 部署验证：${goal}`,
    check: `[check] 测试验证，确保验收条件通过：${goal}`,
    close: `[close] 收口记录，更新文档和 task 状态：${goal}`,
  };

  return defaults[role] ?? `[${role}] ${goal}`;
}

// ── 文件系统接口 ───────────────────────────────────────────────

/** task 文件目录 */
const TASK_DIR = ".dteam/task";

/**
 * 从 task id 读取 task 文件并生成 ChainPlan。
 *
 * @param cwd - 项目根目录
 * @param taskId - task id（如 20260601182644-dcs3）
 * @returns ChainPlan
 * @throws 找不到 task 文件时抛出错误
 */
export async function planFromTaskId(cwd: string, taskId: string): Promise<ChainPlan> {
  if (!/^\d{14}-[a-z0-9]{4}$/.test(taskId)) {
    throw new Error(`Invalid task id: ${taskId}`);
  }

  const taskDir = resolve(cwd, TASK_DIR);
  if (!existsSync(taskDir)) {
    throw new Error(`Task directory not found: ${taskDir}`);
  }

  const files = await readdir(taskDir);
  const file = files.find((f) => f.endsWith(`-${taskId}.md`));
  if (!file) {
    throw new Error(`Task not found: ${taskId}`);
  }

  const content = await readFile(resolve(taskDir, file), "utf-8");
  return generatePlan(content, file);
}
