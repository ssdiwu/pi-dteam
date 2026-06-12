/**
 * dteam v1 — 规划器 (planner)
 *
 * Phase 1：问 LLM 制定执行计划。
 * 策略：先用规则判断（零 LLM 成本），复杂情况才调 LLM 生成 JSON。
 *
 * 0.4.1：availableTools 由主 LLM 调用 dteam 时传入（取代原来的 discoverAndLoadExtensions 发现机制，
 * 旧机制扫不到运行时动态加载的扩展）。设计：见 doc/40-版本实施方案/41-工具动态加载方案.md
 */

import { createWorkerSession, pickAvailableModel } from "./session.js";
import type { ExecutionPlan, ExecMode, RoleName, Strategy } from "./tools.js";

/**
 * 制定 ExecutionPlan。
 *
 * @param goal 全局目标
 * @param ctx dteam run context（含 modelRegistry / cwd / dteam 等）
 * @param availableTools 可选：主 LLM 调 dteam 时传入的可用工具名列表。
 *   - 提供：planner LLM 在 systemPrompt 看到清单 + step.tools 用此集合做 intersect 验证
 *   - 不提供：走 ROLE_DEFAULTS 降级（v0.4.0 行为）
 */
export async function plan(goal: string, ctx: any, availableTools?: string[]): Promise<ExecutionPlan> {
  // 1. 规则判断（零 LLM 成本）
  const quickPlan = quickRuleBasedPlan(goal);
  if (quickPlan) {
    return quickPlan;
  }

  // 2. 复杂情况调 LLM 生成 JSON
  const modelStr = pickAvailableModel(ctx);
  // 0.4.1：主 LLM 传入 availableTools 时，拼到 systemPrompt 里给 LLM 看
  const availableToolNames = new Set(availableTools ?? []);
  const toolsBlock = availableTools && availableTools.length > 0
    ? availableTools.map(n => `- ${n}`).join("\n")
    : "（未提供；不填 tools 字段则用角色默认工具）";
  const systemPrompt = `你是 dteam 的规划器。根据用户目标返回 JSON。

规则：
- mode: solo (1步) | chain (串行) | team (并行，每批≤3)
- role: explore | design | build | check | close
- strategy: direct (跑一次) | build_check (build→check→修, 最多3轮) | adaptive (执行→评估→调, 最多5轮)
- files: 可选，字符串数组，列出该 step 可能读取/修改/验证的项目相对路径；不知道就省略

选择：
- 简单目标 → solo + build + direct
- 中等目标 → chain: explore → build
- 编码目标 → chain: explore → build → check
- 完整目标 → chain: explore → design → build → check → close
- 可并行 → team: 多个 build

[当前可用的工具]
${toolsBlock}
（可选用 tools 字段为每个 step 指定工具子集；不填则用角色默认工具）

你必须且只能返回 JSON 对象，格式：
{"mode":"chain","reason":"...","steps":[{"role":"explore","task":"...","strategy":"direct","files":["src/a.ts"]},{"role":"build","task":"...","strategy":"build_check","files":["src/a.ts"],"tools":["tinyfish_search","read"]}]}`;

  const session = await createWorkerSession({
    systemPrompt,
    cwd: ctx.cwd || process.cwd(),
    modelStr,
    ctx,
  });

  await session.prompt(`目标：${goal}`);

  // 从 messages 中取最终文本
  const messages = session.messages as any[];
  let text = "";
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part.type === "text" && part.text) {
        text = part.text;
        break;
      }
    }
    if (text) break;
  }

  const parsed = extractJSON(text);
  if (parsed) {
    const mode = normalizeMode(String(parsed.mode ?? "solo"));
    const rawSteps = Array.isArray(parsed.steps) ? parsed.steps : [];
    const steps = rawSteps.length > 0
      ? rawSteps.map((s: any) => {
          // 0.4.1：LLM 返回的 step.tools 要 intersect 一下 availableTools 集合，
          // 防止 LLM 填错（拼错/失效），导致 createAgentSession 收到无效名。
          // 仅在 availableTools 提供时才做 intersect；否则按 LLM 原样传（v0.4.0 行为）。
          const tools = Array.isArray(s.tools)
            ? (s.tools as unknown[])
                .filter((t): t is string => typeof t === "string")
                .filter(t => availableToolNames.size === 0 || availableToolNames.has(t))
            : undefined;
          const files = Array.isArray(s.files)
            ? (s.files as unknown[]).filter((f): f is string => typeof f === "string" && f.trim().length > 0)
            : undefined;
          return {
            role: normalizeRole(String(s.role ?? "build")),
            task: String(s.task ?? goal),
            strategy: normalizeStrategy(String(s.strategy ?? "direct")),
            ...(files && files.length > 0 ? { files } : {}),
            ...(tools && tools.length > 0 ? { tools } : {}),
          };
        })
      : [{ role: "build" as RoleName, task: goal, strategy: "direct" as Strategy }];

    return { mode, reason: String(parsed.reason ?? ""), steps };
  }

  // LLM 失败 → fallback
  return {
    mode: "solo",
    reason: "LLM 未返回有效 JSON，fallback",
    steps: [{ role: "build", task: goal, strategy: "direct" }],
  };
}

// ═══ 规则判断（零 LLM 成本） ═══

/**
 * 简单目标用规则判断，避免调 LLM。
 * 返回 null 表示需要走 LLM。
 */
function quickRuleBasedPlan(goal: string): ExecutionPlan | null {
  const g = goal.trim();

  // 空 goal
  if (!g) {
    return {
      mode: "solo",
      reason: "空目标",
      steps: [{ role: "build", task: g, strategy: "direct" }],
    };
  }

  // 特征词
  const isExploratory = /(?:探索|了解|调研|看看|调查|解释|什么|哪些|怎么实现|思路)/.test(g);
  const isCoding = /(?:实现|编写|创建|开发|添加|加|构建|写|改|修复|重构|代码|函数|项目)/.test(g);
  const isVerification = /(?:测试|验证|检查|跑|确认|tsc|pytest)/.test(g);
  const isParallel = /(?:同时|并行|分别|各自|独立|各)/.test(g);
  const isAdaptive = /(?:优化|调整|改进|提升|直到|满意|迭代|慢慢)/.test(g);

  // 短目标 → solo+direct
  if (g.length < 25) {
    return {
      mode: "solo",
      reason: "目标简短，直接干",
      steps: [{ role: "build", task: g, strategy: "direct" }],
    };
  }

  // 并行任务
  if (isParallel && isCoding && !isExploratory) {
    return {
      mode: "team",
      reason: "检测到并行特征",
      steps: [{ role: "build", task: g, strategy: "build_check" }],
    };
  }

  // 编码目标 → chain
  if (isCoding && !isVerification) {
    const strategy: Strategy = isAdaptive ? "adaptive" : "build_check";
    return {
      mode: "chain",
      reason: isAdaptive ? "需要迭代优化" : "编码任务：先探索再实现再验证",
      steps: [
        { role: "explore", task: `探索项目现状：${g}`, strategy: "direct" },
        { role: "build", task: g, strategy },
      ],
    };
  }

  // 探索/调研
  if (isExploratory && !isCoding) {
    return {
      mode: "solo",
      reason: "纯探索任务",
      steps: [{ role: "explore", task: g, strategy: "direct" }],
    };
  }

  // 验证任务
  if (isVerification && !isCoding) {
    return {
      mode: "solo",
      reason: "纯验证任务",
      steps: [{ role: "check", task: g, strategy: "direct" }],
    };
  }

  // 其他 → LLM
  return null;
}

// ═══ JSON 提取 ═══

function extractJSON(text: string): Record<string, any> | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch { /* next */ }
  }

  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    try { return JSON.parse(text.slice(braceStart, braceEnd + 1)); } catch { /* next */ }
  }

  return null;
}

// ═══ 归一化 ═══

function normalizeMode(raw: string): ExecMode {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("chain")) return "chain";
  if (lower.includes("team")) return "team";
  return "solo";
}

function normalizeRole(raw: string): RoleName {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("explor") || lower === "侦察" || lower === "探索") return "explore";
  if (lower.includes("design") || lower === "方案" || lower === "设计") return "design";
  if (lower.includes("build") || lower === "实现" || lower === "构建") return "build";
  if (lower.includes("check") || lower.includes("review") || lower === "验收" || lower === "检查") return "check";
  if (lower.includes("close") || lower === "收口" || lower === "归档") return "close";
  return "build";
}

function normalizeStrategy(raw: string): Strategy {
  const lower = raw.toLowerCase().trim();
  if (lower.includes("build_check") || lower.includes("build-check") || lower === "建检") return "build_check";
  if (lower.includes("adapt") || lower === "自适应" || lower === "迭代") return "adaptive";
  return "direct";
}
