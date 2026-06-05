/**
 * dteam/leaf/extract.ts — 从 session.messages 提取最终文本
 *
 * 【重构方案】Phase 3 - C 拆出。L-6（修 extractLastText 行为）暂不做——
 * 当前 L-6 的"跳过有 toolCall 的"行为会改变业务输出，与既有测试冲突。
 * Phase 3 只搬函数，不动行为。
 */

/**
 * 从 messages 提取最后一条 assistant 的第一个 text part 的 text。
 * 如果没有 assistant message 或没有 text part，返回 "(no output)"。
 */
export function extractLastText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part.type === "text") return part.text;
    }
  }
  return "(no output)";
}
