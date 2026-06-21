/**
 * Orchestrator LLM 决策的 prompt 构建与 JSON 解析
 *
 * Orchestrator 每轮一次 LLM 调用，输入：
 *  - goal
 *  - SignalStore 当前活跃快照
 *  - 已完成 SummonStep 结果
 *
 * 输出 OrchestratorDecision JSON（summon/check/done/fail 四态）。
 *
 * 决策依据：ADR 0005 第 17 条（LLM-Driven Orchestration）。
 * 不用 tool calling（与 planner 一致：JSON 模式更可控）。
 */

import type { Signal } from "../tools.js";
import type {
  OrchestratorDecision,
  OrchestratorSummonDecision,
  OrchestratorCheckDecision,
  OrchestratorDoneDecision,
  OrchestratorFailDecision,
  SummonStep,
} from "../types/loop.js";
import type { RoleName } from "../types/role.js";

const VALID_ROLES: RoleName[] = ["explore", "design", "build", "check", "close"];

/** 构建给 Orchestrator LLM 的 system prompt */
export function buildOrchestratorSystemPrompt(): string {
  return `你是 dteam 的 Orchestrator（编排者）。你的职责是推进目标：每轮根据当前信号和已完成工作，决定下一步召唤哪个专业角色。

## 五个专业角色
- explore：读代码、查资料、发现入口和风险
- design：输出实施方案、权衡、ADR
- build：写代码、改文档、补测试（唯一能改现有文件）
- check：跑测试、审查结果、指出问题（收口闸门）
- close：总结、归档、沉淀经验

## 如何上报决策（最重要）
你每一轮**必须调用 orchestrator_decide 工具**来上报决策。不要返回纯文本，不要返回 JSON 代码块，不要写任何解释——直接调用工具。工具的参数就是你的决策。决策有四种：
- type=summon：召唤一个角色干活。填 role（哪个角色）、task（给它什么任务，简短具体≤200字）、reason（为什么）、可选 parallel（并发数）。
- type=check：召唤 check 角色收口。填 task（验证什么）、reason。
- type=done：目标达成。仅当 check 通过后才用。填 reason。
- type=fail：无法继续。填 reason。

## 规则
- 任务从执行中涌现，不要预先穷举所有步骤
- 根据 SignalStore 的信号判断当前最缺什么角色
- **目标性质→角色能力**：目标只要读/查/说明/解释/定位（不要求改文件），绝不能召唤 build 或 close——build 只在目标明确要求改文件时才用。不要为了“固化结果”擅自把探索产物落盘。
- 目标主体完成后，必须走 check 收口（Completion Gate），不能自己判定 done
- 只有 check 通过后，才能上报 type=done
- role 只能是 explore/design/build/check/close 之一
- **连续失败换策略**：同一角色连续 2 次失败或被中断后，必须换策略（换角色、缩小 task 范围、或直接 check/fail），不要盲目重试同类`;
}

/** 构建 Orchestrator LLM 的 user prompt（含 goal + 信号 + 已完成轨迹） */
export function buildOrchestratorUserPrompt(
  goal: string,
  signals: Signal[],
  summonTrail: SummonStep[],
  checkRound: number,
): string {
  const lines: string[] = [];

  lines.push(`# 目标\n${goal}`);
  lines.push("");

  // 已完成轨迹
  if (summonTrail.length === 0) {
    lines.push("# 已完成工作\n（尚未开始，请决定第一步召唤谁）");
  } else {
    lines.push("# 已完成工作（召唤轨迹）");
    for (const s of summonTrail) {
      let flag = s.status === "done" ? "✓" : s.status === "failed" ? "✗" : "◐";
      if (s.interrupted) flag = "⏹"; // 被工具上限中断
      const tag = s.interrupted ? " [被中断]" : "";
      const result = s.result ? ` → ${truncate(s.result, 200)}` : "";
      lines.push(`- ${flag} [${s.role}]${tag} ${truncate(s.task, 100)}${result}`);
    }
    // 连续失败/中断统计（供 Orchestrator 感知，防盲目重试）
    const lastRole = summonTrail[summonTrail.length - 1]?.role;
    if (lastRole) {
      let consec = 0;
      for (let i = summonTrail.length - 1; i >= 0; i--) {
        const s = summonTrail[i];
        if (s.role !== lastRole) break;
        if (s.status === "failed" || s.interrupted) consec++;
        else break;
      }
      if (consec >= 2) {
        lines.push("");
        lines.push(`⚠️ ${lastRole} 已连续 ${consec} 次失败/被中断。按规则你必须换策略：换角色、缩小 task 范围、或直接 check/fail，不要盲目重试同类。`);
      }
    }
  }
  lines.push("");

  // 信号快照
  if (signals.length === 0) {
    lines.push("# 当前活跃信号\n（无）");
  } else {
    lines.push("# 当前活跃信号（按强度降序）");
    for (const s of signals.slice(0, 15)) {
      const data = s.data as any;
      const summary = data.summary ?? data.message ?? data.whatMissing ?? JSON.stringify(data).slice(0, 100);
      lines.push(`- [${s.type}] ${truncate(summary, 120)}`);
    }
  }
  lines.push("");

  if (checkRound > 0) {
    lines.push(`# check 轮次\n第 ${checkRound} 次收口尝试。上次 check 未通过，请根据问题决定修复方向。`);
    lines.push("");
  }

  lines.push("# 请返回下一步决策（仅 JSON）");
  return lines.join("\n");
}

/**
 * 解析 Orchestrator LLM 的自由文本 JSON 输出为 OrchestratorDecision。
 * 解析失败返回 fail 决策（不让 loop 卡死）。
 *
 * 【已废弃，保留备查】0.6.0 tool calling 契约上线后，runLoop/decide 主路径改用
 * orchestrator_decide customTool（见 decision-tool.ts），不再调用本函数。
 * 保留用于历史调试参考与潜在的“tool calling 不可用时的回退”场景，当前无调用点。
 */
export function parseOrchestratorDecision(text: string): OrchestratorDecision {
  const parsed = extractJSON(text);
  if (!parsed || typeof parsed !== "object") {
    return { type: "fail", reason: `Orchestrator 未返回有效 JSON: ${truncate(text, 200)}` };
  }

  const type = String(parsed.type ?? "").toLowerCase().trim();

  if (type === "summon") {
    const role = normalizeRole(parsed.role);
    const parallelRaw = Number(parsed.parallel);
    const parallel = Number.isFinite(parallelRaw) && parallelRaw >= 1 ? Math.floor(parallelRaw) : undefined;
    return {
      type: "summon",
      role,
      task: String(parsed.task ?? "").trim() || "（Orchestrator 未给出任务说明）",
      reason: String(parsed.reason ?? "").trim(),
      ...(parallel && parallel > 1 ? { parallel } : {}),
      ...(Array.isArray(parsed.tools)
        ? { tools: (parsed.tools as unknown[]).filter((t): t is string => typeof t === "string") }
        : {}),
    } satisfies OrchestratorSummonDecision;
  }

  if (type === "check") {
    return {
      type: "check",
      task: String(parsed.task ?? "验证目标是否达成").trim(),
      reason: String(parsed.reason ?? "").trim(),
    } satisfies OrchestratorCheckDecision;
  }

  if (type === "done") {
    return {
      type: "done",
      reason: String(parsed.reason ?? "").trim(),
    } satisfies OrchestratorDoneDecision;
  }

  if (type === "fail") {
    return {
      type: "fail",
      reason: String(parsed.reason ?? "").trim(),
    } satisfies OrchestratorFailDecision;
  }

  return { type: "fail", reason: `未知决策类型: ${type}` };
}

function normalizeRole(raw: unknown): RoleName {
  const lower = String(raw ?? "").toLowerCase().trim();
  const found = VALID_ROLES.find(r => lower.includes(r));
  return found ?? "build";
}

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

function truncate(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}
