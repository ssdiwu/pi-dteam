/**
 * dteam v1 — 叶子器 (leaf)
 *
 * 唯一职责：调 LLM 实际执行一个 subTask。
 *
 * v1.1：暴露 read/bash/edit/write 工具，让 leaf 能真正改文件。
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
    `You have access to read, bash, edit, and write tools.\n` +
    `Use them to actually complete the task. Do not just describe what you would do — DO it.\n` +
    `When done, provide a brief summary of what you accomplished.`;

  // 从 ctx 拿模型信息，优先用 MiniMax-M3
  const modelStr = "minimax-cn/MiniMax-M3";

  const session = await createWorkerSession({
    role: "build",
    cwd: ctx.cwd || process.cwd(),
    modelStr,
    ctx,
    // 内置工具：让 leaf 能真正读文件、跑命令、改文件
    builtInTools: ["read", "bash", "edit", "write"],
  });

  // 发 prompt
  await session.prompt("Execute this task now.");

  // 从 session.messages 取最终文本
  const messages = session.messages as any[];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part.type === "text") {
        return part.text;
      }
    }
  }

  return "(no output)";
}
