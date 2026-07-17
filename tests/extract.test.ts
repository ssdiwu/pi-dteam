import { describe, expect, it } from "bun:test";
import { extractLastText } from "../src/runtime/extract.js";

describe("extractLastText", () => {
  it("合并最后一条 assistant message 的所有文本片段", () => {
    expect(extractLastText([
      { role: "assistant", content: [{ type: "text", text: "第一段" }, { type: "toolCall", name: "read" }, { type: "text", text: "第二段" }] },
    ])).toBe("第一段\n第二段");
  });
});
