/**
 * dteam v1 — 规划器 (planner)
 *
 * Phase 1：问 LLM 制定执行计划。
 * 策略：先用规则判断（零 LLM 成本），复杂情况才调 LLM 生成 JSON。
 */

import { createWorkerSession, pickAvailableModel } from "./session.js";
import type { ExecutionPlan, ExecMode, RoleName, Strategy } from "./tools.js";

export async function plan(goal: string, ctx: any): Promise<ExecutionPlan> {
  // 1. 规则判断（零 LLM 成本）
  const quickPlan = quickRuleBasedPlan(goal);
  if (quickPlan) {
    return quickPlan;
  }

  // 2. 复杂情况调 LLM 生成 JSON
  const modelStr = pickAvailableModel(ctx, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7");
  const systemPrompt = `你是 dteam 的规划器。根据用户目标返回 JSON。

规则：
- mode: solo (1步) | chain (串行) | team (并行，每批≤3)
- role: explore | design | build | check | close
- strategy: direct (跑一次) | build_check (build→check→修, 最多3轮) | adaptive (执行→评估→调, 最多5轮)

选择：
- 简单目标 → solo + build + direct
- 中等目标 → chain: explore → build
- 编码目标 → chain: explore → build → check
- 完整目标 → chain: explore → design → build → check → close
- 可并行 → team: 多个 build

你必须且只能返回 JSON 对象，格式：
{"mode":"chain","reason":"...","steps":[{"role":"explore","task":"...","strategy":"direct"},{"role":"build","task":"...","strategy":"build_check"}]}`;

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
      ? rawSteps.map((s: any) => ({
          role: normalizeRole(String(s.role ?? "build")),
          task: String(s.task ?? goal),
          strategy: normalizeStrategy(String(s.strategy ?? "direct")),
        }))
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
