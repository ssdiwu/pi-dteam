/**
 * 循环检测器单元测试
 */

import { describe, it, expect } from "vitest";
import { LoopDetector } from "../../src/P0/loopDetector.js";

describe("LoopDetector", () => {
  it("检测完全相同的调用", () => {
    const detector = new LoopDetector({ maxIdenticalCalls: 3 });

    detector.record("read", { path: "file.txt" });
    detector.record("read", { path: "file.txt" });
    detector.record("read", { path: "file.txt" });
    detector.record("read", { path: "file.txt" });

    // 第5次调用应该被检测为循环
    const result = detector.check("read", { path: "file.txt" });
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain("连续 4 次完全相同的 read 调用");
  });

  it("检测渐进式参数变化", () => {
    const detector = new LoopDetector({ maxSimilarCalls: 3 });

    detector.record("grep", { args: "-A 60 pattern file.txt" });
    detector.record("grep", { args: "-A 70 pattern file.txt" });
    detector.record("grep", { args: "-A 80 pattern file.txt" });

    // 第4次调用应该被检测为循环
    const result = detector.check("grep", { args: "-A 90 pattern file.txt" });
    expect(result.isLoop).toBe(true);
    expect(result.reason).toContain("渐进式参数变化");
  });

  it("文件大小检测提示", () => {
    const detector = new LoopDetector();

    // 没有offset/limit的read调用
    const result = detector.check("read", { path: "file.txt" });
    expect(result.isLoop).toBe(false);
    expect(result.suggestion).toContain("小文件（<500行）直接 read 全文");
  });

  it("不检测正常的调用", () => {
    const detector = new LoopDetector();

    detector.record("read", { path: "alpha.txt" });
    detector.record("read", { path: "beta.txt" });
    detector.record("read", { path: "gamma.txt" });

    // 不同的调用不应该被检测为循环
    const result = detector.check("read", { path: "delta.txt" });
    expect(result.isLoop).toBe(false);
    expect(result.suggestion).toContain("小文件（<500行）直接 read 全文");
  });

  it("清空历史记录", () => {
    const detector = new LoopDetector({ maxIdenticalCalls: 2 });

    detector.record("read", { path: "file.txt" });
    detector.clear();

    // 清空后不应该被检测为循环
    detector.record("read", { path: "file.txt" });
    const result = detector.check("read", { path: "file.txt" });
    expect(result.isLoop).toBe(false);
  });
});
