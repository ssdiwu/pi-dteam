/**
 * check 收口 customTool（替代关键词收口判定）
 *
 * 决策依据：ADR 0005 第 14 条（强制 check 收口）。
 * 用 Pi tool calling 取代"check worker 返回自由文本 + 关键词正则猜 passed"——
 * 消灭探测报告 P0-4（check 收口判定脆弱）。
 *
 * 设计：对称于 decision-tool.ts。check worker session 注入此 tool；
 * check worker 调用它上报结构化收口结论；execute 闭包写入 receiver；
 * runLoop 从 receiver 取 CheckResult，不再调 parseCheckResult。
 */

import type { CheckResult } from "../types/loop.js";

/**
 * 收口结论接收器：runLoop 创建后传入 tool，execute 写入，runLoop 读取。
 * 每次 check 召唤前新建。
 */
export interface CheckConclusionReceiver {
  conclusion: CheckResult | null;
}

export function createCheckConclusionReceiver(): CheckConclusionReceiver {
  return { conclusion: null };
}

/**
 * 创建 check_conclude customTool。
 * 闭包捕获 receiver，check worker 调用时把结构化结论写入 receiver.conclusion。
 */
export function makeCheckConcludeTool(receiver: CheckConclusionReceiver) {
  return {
    name: "check_conclude",
    label: "check_conclude",
    description:
      "上报收口结论。check 角色完成验收后必须调用且只调用一次。" +
      "passed=true 表示目标达成可收口；passed=false 表示未达成，Orchestrator 会根据 issues 决定修复方向。",
    promptGuidelines: [
      "你完成验收后必须调用 check_conclude 工具上报结论，不要只返回文本。",
      "passed 必须基于你实际验证到的事实，不能凭感觉。未验证到的项不要判 passed。",
      "issues 写未通过的具体问题（每条≤150 字符），供 Orchestrator 决定如何修复。",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        passed: {
          type: "boolean" as const,
          description: "目标是否达成可收口。true=通过，false=未通过（需修复）",
        },
        summary: {
          type: "string" as const,
          maxLength: 500,
          description: "验收结论摘要（≤500 字符）：验了什么、结果如何",
        },
        issues: {
          type: "array" as const,
          items: {
            type: "string" as const,
            maxLength: 150,
          },
          description: "未通过的问题清单（仅 passed=false 时填，每条≤150 字符）",
        },
      },
      required: ["passed", "summary"],
    },
    async execute(
      _toolCallId: string,
      params: {
        passed?: boolean;
        summary?: string;
        issues?: unknown;
      },
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      const passed = Boolean(params.passed);
      const summary = String(params.summary ?? "").trim() || "(check 未给出摘要)";
      const issues = Array.isArray(params.issues)
        ? params.issues
            .map(i => String(i).slice(0, 150))
            .filter(s => s.length > 0)
            .slice(0, 10)
        : undefined;

      receiver.conclusion = {
        passed,
        output: summary,
        issues: passed ? undefined : issues,
        round: 0, // round 由 runLoop 在读取后回填
      };

      const ack = passed
        ? `已记录收口结论：通过（${summary.slice(0, 60)}${summary.length > 60 ? "…" : ""}）`
        : `已记录收口结论：未通过，${issues?.length ?? 0} 个问题`;

      return {
        content: [{ type: "text" as const, text: ack }],
      };
    },
  };
}
