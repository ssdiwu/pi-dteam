/**
 * check 收口闸门（Completion Gate）的结果判定
 *
 * check 角色是固定五角色之一，但它的输出要走结构化判定：
 *  - passed=true  → Orchestrator 才能产出 "done"
 *  - passed=false → Orchestrator 继续召唤（通常是 build 修复）直到 maxCheckRetries
 *
 * 决策依据：ADR 0005 第 14 条（强制 check 收口）。
 *
 * 判定策略：让 check worker 在输出里用约定标记表示通过/不通过。
 *  - 显式 JSON：`{"passed":true|false,"issues":[...]}`
 *  - 关键词兜底：含 通过/pass/✓/verified 视为 passed；含 失败/fail/✗/未通过 视为 reject
 */

import type { CheckResult } from "../types/loop.js";

const PASS_KEYWORDS = /(?:通过|验收通过|pass(?:ed)?|verified|确认完成|✓|🟢|完成.*验证)/i;
const FAIL_KEYWORDS = /(?:失败|未通过|不通过|fail(?:ed)?|reject|✗|❌|🔴|问题.*未解决|仍有)/i;

/**
 * 从 check worker 的输出解析 CheckResult。
 */
export function parseCheckResult(output: string, round: number): CheckResult {
  // 1. 显式 JSON 优先
  const json = extractCheckJSON(output);
  if (json) {
    return {
      passed: Boolean(json.passed),
      output,
      issues: Array.isArray(json.issues)
        ? (json.issues as unknown[]).map(i => String(i)).slice(0, 10)
        : undefined,
      round,
    };
  }

  // 2. 关键词兜底
  const hasFail = FAIL_KEYWORDS.test(output);
  const hasPass = PASS_KEYWORDS.test(output);
  // fail 关键词优先级更高（"未通过" 含 "通过"，会误判）
  const passed = !hasFail && hasPass;

  return {
    passed,
    output,
    issues: passed ? undefined : extractIssues(output),
    round,
  };
}

/** 尝试从输出里提取 check JSON */
function extractCheckJSON(text: string): { passed?: boolean; issues?: unknown[] } | null {
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) {
    try {
      const obj = JSON.parse(fenceMatch[1].trim());
      if (obj && typeof obj === "object" && "passed" in obj) return obj;
    } catch { /* next */ }
  }
  const braceStart = text.indexOf("{");
  const braceEnd = text.lastIndexOf("}");
  if (braceStart >= 0 && braceEnd > braceStart) {
    try {
      const obj = JSON.parse(text.slice(braceStart, braceEnd + 1));
      if (obj && typeof obj === "object" && "passed" in obj) return obj;
    } catch { /* next */ }
  }
  return null;
}

/** 从输出提取问题列表（按行粗提取带 - 或数字开头的行） */
function extractIssues(output: string): string[] | undefined {
  const lines = output.split("\n");
  const issues: string[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (/^[-*]\s+/.test(trimmed) || /^\d+[.)]\s+/.test(trimmed)) {
      // 去掉前缀符号
      const issue = trimmed.replace(/^[-*]\s+|^\d+[.)]\s+/, "").trim();
      if (issue && issue.length > 2 && issues.length < 10) {
        issues.push(issue.slice(0, 200));
      }
    }
  }
  return issues.length > 0 ? issues : undefined;
}
