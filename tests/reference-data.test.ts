/**
 * reference-data.ts 测试
 *
 * 测试 referenceArchitectureTool 的过滤和输出格式。
 */

import { describe, it, expect } from "vitest";
import { referenceArchitectureTool } from "../src/reference-data.js";

async function callTool(pattern?: string): Promise<string> {
  const result = await (referenceArchitectureTool as any).execute(
    "test-id",
    { pattern },
    undefined,
    undefined,
    undefined,
  );
  return result.content[0].text;
}

describe("referenceArchitectureTool", () => {
  it("不传 pattern 返回全部 12 个模式", async () => {
    const text = await callTool();
    // 验证全部 12 个模式都存在
    const names = ["monolith", "microservices", "layered", "hexagonal",
      "event-driven", "cqrs", "serverless", "microkernel",
      "pipe-filter", "space-based", "client-server", "peer-to-peer"];
    for (const name of names) {
      expect(text).toContain(`## ${name} (${name})`);
    }
  });

  it("按 name 过滤", async () => {
    const text = await callTool("microservices");
    expect(text).toContain("microservices");
    expect(text).toContain("ADR 草稿模板");
    // 不应包含其他模式
    expect(text).not.toContain("## monolith");
  });

  it("按 category 过滤", async () => {
    const text = await callTool("event-driven");
    expect(text).toContain("event-driven");
    expect(text).toContain("ADR 草稿模板");
  });

  it("部分匹配", async () => {
    const text = await callTool("micro");
    // 应匹配 microservices 和 microkernel
    const headers = text.match(/^## \w+ \(\w/mg) ?? [];
    expect(headers.length).toBe(2);
  });

  it("无匹配返回提示", async () => {
    const text = await callTool("nonexistent-pattern-xyz");
    expect(text).toContain("未找到匹配");
    expect(text).toContain("可用模式");
  });

  it("输出包含优缺点和 ADR 模板", async () => {
    const text = await callTool("monolith");
    expect(text).toContain("**优点**");
    expect(text).toContain("**缺点**");
    expect(text).toContain("**适用**");
    expect(text).toContain("**不适用**");
    expect(text).toContain("ADR-XXX");
  });
});
