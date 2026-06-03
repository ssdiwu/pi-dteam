/**
 * dteam v1 — 分支器 (brancher)
 *
 * 唯一职责：问 LLM "这个 subTask 还要拆吗？"
 *
 * v1 实现：用 `completeSimple` 直接调 LLM，把决策编码成 tool call。
 * 用 typebox 定义 schema（Pi SDK 要求）。
 */

import { completeSimple, Type } from "@earendil-works/pi-ai";
import type { Decision, Task } from "./tools.js";

/**
 * 让 LLM 决定：拆还是干。
 *
 * @param task 当前 subTask
 * @param model 当前会话的 Model 对象
 * @param goal 原始 goal（让 LLM 知道总目标）
 */
export async function decide(
  task: Task,
  model: any,
  goal: string,
): Promise<Decision> {
  const systemPrompt =
    `You are the brancher in dteam's recursive worker tree.\n` +
    `\n` +
    `The user originally asked: "${goal}"\n` +
    `\n` +
    `You are now deciding what to do with this sub-task:\n` +
    `  Title: ${task.title}\n` +
    `  Description: ${task.description}\n` +
    `\n` +
    `Decide ONE of:\n` +
    `- "execute": this sub-task is small enough that a single LLM call can do it.\n` +
    `- "decompose": this sub-task is too big, break it into 2-5 smaller sub-tasks.\n` +
    `\n` +
    `You MUST call the decide tool with the structured decision. Do not output any other text.`;

  const context = {
    systemPrompt,
    messages: [
      {
        role: "user" as const,
        content: "Decide now.",
        timestamp: Date.now(),
      },
    ],
    tools: [
      {
        name: "decide",
        description: "Call this with your decision: either execute directly or decompose into sub-tasks.",
        parameters: Type.Object({
          kind: Type.Union([Type.Literal("execute"), Type.Literal("decompose")]),
          reason: Type.String(),
          subTasks: Type.Optional(
            Type.Array(
              Type.Object({
                title: Type.String(),
                description: Type.String(),
              }),
            ),
          ),
        }),
      },
    ],
  };

  const result: any = await completeSimple(model, context);

  // 从 result.content 里找 toolCall
  const content = Array.isArray(result.content) ? result.content : [];
  let details: any = null;
  for (const part of content) {
    if (part?.type === "toolCall" && part.name === "decide") {
      details = part.arguments;
      break;
    }
  }

  if (!details || typeof details !== "object") {
    // debug: 看看 LLM 实际返回了什么
    const debug = content.map((c: any) => ({ type: c?.type, name: c?.name, text: c?.text?.slice(0, 100) }));
    throw new Error(`Brancher: LLM did not call decide tool. Got: ${JSON.stringify(debug)}`);
  }

  if (details.kind === "execute") {
    return { kind: "execute", reason: String(details.reason ?? "") };
  }

  if (details.kind === "decompose") {
    const subs = Array.isArray(details.subTasks) ? details.subTasks : [];
    return {
      kind: "decompose",
      reason: String(details.reason ?? ""),
      subTasks: subs.map((s: any) => ({
        title: String(s.title ?? "Untitled"),
        description: String(s.description ?? ""),
      })),
    };
  }

  throw new Error(`Brancher: unexpected kind: ${details.kind}`);
}
