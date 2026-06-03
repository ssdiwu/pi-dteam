/**
 * dteam v1 — 叶子器 (leaf)
 *
 * 唯一职责：调 LLM 实际执行一个 subTask。
 *
 * v1 用 createAgentSession，目前不暴露额外工具（v1.1 加）。
 * LLM 只描述"会怎么做"，不直接改文件。
 */

import { createWorkerSession } from "./session.js";
import type { Task } from "./tools.js";

/**
 * 执行一个 leaf task。
 */
export async function execute(
  task: Task,
  ctx: any,
  goal: string,
): Promise<string> {
  const systemPrompt =
    `You are a leaf worker in dteam's recursive worker tree.\n` +
    `\n` +
    `The user originally asked: "${goal}"\n` +
    `\n` +
    `You are now executing this sub-task:\n` +
    `  Title: ${task.title}\n` +
    `  Description: ${task.description}\n` +
    `\n` +
    `Describe concisely what you would do to complete this task. Be specific.` +
    `\n` +
    `In v1, you cannot modify files. Just describe the action plan.`;

  // 从 ctx 拿模型信息
  const model = ctx.model;
  const modelStr = model ? `${model.provider}/${model.id}` : null;
  if (!modelStr) throw new Error("Leaf: no model available in ctx");

  const session = await createWorkerSession({
    systemPrompt,
    cwd: ctx.cwd || process.cwd(),
    modelStr,
    ctx,
    // v1 不暴露工具；v1.1 加 read/bash/edit/write
    tools: [],
  });

  // 发 prompt
  await session.prompt("Execute now.");

  // 从 session.messages 取最终文本
  const messages = session.messages;
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if ((part as any).type === "text") {
        return (part as any).text;
      }
    }
  }

  return "(no output)";
}
