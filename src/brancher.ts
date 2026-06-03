/**
 * dteam v1 — 分支器 (brancher)
 *
 * 唯一职责：问 LLM "这个 subTask 还要拆吗？"
 *
 * 用 createAgentSession（走 auth.json 解析 API key）。
 * 用 typebox 定义 decide 工具 schema，让 LLM 返回结构化决策。
 */

import { Type } from "@earendil-works/pi-ai";
import type { Decision, Task } from "./tools.js";
import { createWorkerSession } from "./session.js";

/**
 * 让 LLM 决定：拆还是干。
 */
export async function decide(
  task: Task,
  ctx: any,
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

  // 从 ctx 拿模型信息，优先用 MiniMax-M3
  const model = ctx.model;
  const modelStr = "minimax-cn/MiniMax-M3";

  const session = await createWorkerSession({
    systemPrompt,
    cwd: ctx.cwd || process.cwd(),
    modelStr,
    ctx,
    customTools: [
      {
        name: "decide",
        label: "decide",
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
  });

  // 发 prompt，等 LLM 回复
  await session.prompt("Decide now.");

  // 从 session.messages 里找 toolCall
  const messages = session.messages as any[];
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part.type === "toolCall" && part.name === "decide") {
        const details = part.arguments;
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
    }
  }

  // 没找到 decide tool call — debug
  const lastMsg = messages[messages.length - 1];
  const debug = Array.isArray(lastMsg?.content)
    ? lastMsg.content.map((c: any) => ({ type: c?.type, name: c?.name, text: c?.text?.slice(0, 200) }))
    : "no content";
  throw new Error(`Brancher: LLM did not call decide tool. Got: ${JSON.stringify(debug)}`);
}
