/**
 * dteam/leaf/extract.ts — 从 session.messages 提取最终文本。
 *
 * 从最后一条 assistant message 合并全部 text part；tool call 只作为同一条
 * assistant message 中的非文本片段跳过，不影响文本结果。
 */

/**
 * 从 messages 提取最后一条 assistant 的全部 text part。
 * 如果没有 assistant message 或没有非空 text part，返回 "(no output)"。
 */
export function extractLastText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    const text = content
      .filter((part) => part?.type === "text" && typeof part.text === "string")
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "(no output)";
}
