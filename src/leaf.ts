/**
 * dteam v1 — 叶子器 (leaf)
 *
 * 唯一职责：让 LLM 实际干活。
 *
 * v1 实现：用 `completeSimple` 调 LLM，让 LLM 完成被 brancher 判定为可执行的 subTask。
 *
 * v1 简化：不接 read/bash/edit/write 工具（v1 最小闭环，先证明树跑通）。
 * 后续迭代再让 leaf 真正能改文件。
 */

import { completeSimple } from "@earendil-works/pi-ai";
import type { Task } from "./tools.js";

/**
 * 让 LLM 完成一个 subTask。
 *
 * @param task 当前 subTask（已被 brancher 判定可执行）
 * @param model 当前会话的 Model 对象
 * @param goal 原始 goal
 * @returns LLM 的最终输出文本
 */
export async function execute(
  task: Task,
  model: any,
  goal: string,
): Promise<string> {
  const systemPrompt =
    `You are a leaf worker in dteam's recursive worker tree.\n` +
    `\n` +
    `The user originally asked: "${goal}"\n` +
    `\n` +
    `Your job: complete this specific sub-task:\n` +
    `  Title: ${task.title}\n` +
    `  Description: ${task.description}\n` +
    `\n` +
    `Briefly describe what you would do to complete this sub-task.\n` +
    `Be specific and concrete. Do not output code blocks.`;

  const context = {
    systemPrompt,
    messages: [
      {
        role: "user" as const,
        content: task.description,
        timestamp: Date.now(),
      },
    ],
  };

  const result: any = await completeSimple(model, context);

  // 抽 text 内容
  const content = Array.isArray(result.content) ? result.content : [];
  for (const part of content) {
    if (part?.type === "text" && typeof part.text === "string") {
      return part.text;
    }
  }
  return "(no output)";
}
