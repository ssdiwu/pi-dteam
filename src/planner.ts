/**
 * dteam v1 — 规划器 (planner)
 *
 * Phase 1：问 LLM 制定执行计划。
 * 输出 ExecutionPlan：mode (solo/chain/team) + steps (每个 step 独立选 strategy)。
 */

import { Type } from "@earendil-works/pi-ai";
import { createWorkerSession } from "./session.js";
import type { ExecutionPlan } from "./tools.js";

export async function plan(goal: string, ctx: any): Promise<ExecutionPlan> {
  const systemPrompt = `你是 dteam 的规划器。根据用户目标，制定执行计划。

## 两个维度（完全独立，任意组合）

### 维度一：组织形式（怎么组织多个步骤）
- solo: 单步执行
- chain: 串行执行，前一步输出自动注入下一步
- team: 并行执行，每批最多 3 个

### 维度二：执行策略（每个步骤独立选择）
- direct: 跑一次出结果（适合读文件、跑命令、简单查询）
- build_check: build→check→不通过就修→再check，最多 3 轮（适合写代码）
- adaptive: 执行→评估→不满意就调→再评估，最多 5 轮（适合模糊目标）

## 5 个角色
- explore: 探索者，搜集信息（只读）
- design: 方案制定者（只读）
- build: 实现者（唯一能改代码的角色）
- check: 验收者（只读 + 跑测试）
- close: 收口者（归档）

## 角色链参考
- 简单目标 → solo: build
- 中等目标 → chain: explore → build
- 编码目标 → chain: explore → build → check
- 完整目标 → chain: explore → design → build → check → close
- 并行目标 → team: 多个 build 并行

## 策略参考
- explore/design/check/close → 通常用 direct
- build（写代码）→ 通常用 build_check
- build（优化/调整）→ 用 adaptive
- build（一步到位）→ 用 direct

## 规则
- solo 只能有 1 个 step
- chain 的步骤按顺序串行
- team 不要超过 5 个 step
- 每个步骤独立选择策略

调用 plan 工具返回结构化执行计划。不要输出其他文本。`;

  const session = await createWorkerSession({
    systemPrompt,
    cwd: ctx.cwd || process.cwd(),
    modelStr: "minimax-cn/MiniMax-M3",
    ctx,
    customTools: [
      {
        name: "plan",
        label: "plan",
        description: "为这个 goal 制定执行计划",
        parameters: Type.Object({
          mode: Type.Union([Type.Literal("solo"), Type.Literal("chain"), Type.Literal("team")]),
          reason: Type.String({ description: "为什么选这个模式" }),
          steps: Type.Array(
            Type.Object({
              role: Type.Union([
                Type.Literal("explore"),
                Type.Literal("design"),
                Type.Literal("build"),
                Type.Literal("check"),
                Type.Literal("close"),
              ]),
              task: Type.String({ description: "具体任务描述" }),
              strategy: Type.Union([
                Type.Literal("direct"),
                Type.Literal("build_check"),
                Type.Literal("adaptive"),
              ]),
              files: Type.Optional(Type.Array(Type.String())),
            }),
          ),
        }),
      },
    ],
  });

  await session.prompt(`目标：${goal}\n\n请制定执行计划。`);

  // 从 messages 中找 plan tool call
  const messages = session.messages as any[];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part.type === "toolCall" && part.name === "plan") {
        const args = part.arguments;
        return {
          mode: args.mode ?? "solo",
          reason: String(args.reason ?? ""),
          steps: (Array.isArray(args.steps) ? args.steps : []).map((s: any) => ({
            role: s.role ?? "build",
            task: String(s.task ?? goal),
            strategy: s.strategy ?? "direct",
            files: Array.isArray(s.files) ? s.files : undefined,
          })),
        };
      }
    }
  }

  // Fallback：LLM 没返回 plan → solo + direct + build
  return {
    mode: "solo",
    reason: "LLM 未返回计划，fallback",
    steps: [{ role: "build", task: goal, strategy: "direct" }],
  };
}
