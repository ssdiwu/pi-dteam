/**
 * dteam v1 — 分支器 (brancher)
 *
 * 唯一职责：问 LLM "这个 subTask 还要拆吗？"
 *
 * v1 实现：用 `completeSimple` 直接调 LLM，把决策编码成 tool call。
 */

import { completeSimple } from "@earendil-works/pi-ai";
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
        description: "Call this with your decision",
        parameters: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["execute", "decompose"] },
            reason: { type: "string" },
            subTasks: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  title: { type: "string" },
                  description: { type: "string" },
                },
                required: ["title", "description"],
              },
            },
          },
          required: ["kind", "reason"],
        },
      },
    ],
  };

  const result: any = await completeSimple(model, context);

  // 从 result.content 里找 toolCall
  const content = Array.isArray(result.content) ? result.content : [];
  let details: any = null;
  for (const part of content) {
    if (part?.type === "toolCall" && part.name === "decide") {
      details = part.arguments ?? part.args;
      break;
    }
  }

  if (!details || typeof details !== "object") {
    throw new Error("Brancher: LLM did not call decide tool");
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
