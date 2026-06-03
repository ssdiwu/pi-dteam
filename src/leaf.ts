/**
 * dteam v1 — 叶子执行器 (leaf)
 *
 * 唯一职责：用指定角色调 LLM 执行一个 step。
 * 角色决定 systemPrompt + tools（由 session.ts 的角色系统处理）。
 */

import { createWorkerSession } from "./session.js";
import type { RoleName } from "./tools.js";

/**
 * 用指定角色执行一个任务。
 *
 * @param role  角色（决定 systemPrompt + tools）
 * @param task  具体任务描述
 * @param ctx   Pi 扩展上下文
 * @param goal  全局目标（注入 prompt 供参考）
 * @returns     LLM 的最终文本输出
 */
export async function execute(
  role: RoleName,
  task: string,
  ctx: any,
  goal: string,
): Promise<string> {
  const session = await createWorkerSession({
    role,
    cwd: ctx.cwd || process.cwd(),
    modelStr: "minimax-cn/MiniMax-M3",
    ctx,
  });

  // 注入全局目标供角色参考
  const fullPrompt = `[全局目标: ${goal}]\n\n${task}`;
  await session.prompt(fullPrompt);

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
