/** 从最后一条 assistant message 提取全部 text part；结构化工具调用不会干扰最终文本。 */
export function extractLastText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message?.role !== "assistant") continue;
    const text = (Array.isArray(message.content) ? message.content : [])
      .filter((part: any) => part?.type === "text" && typeof part.text === "string")
      .map((part: any) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  return "(no output)";
}
