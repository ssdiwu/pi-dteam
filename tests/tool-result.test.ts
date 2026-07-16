import { describe, expect, it } from "vitest";
import { humanizeToolResult } from "../src/tui/tool-result.js";

describe("human-readable tool result projection", () => {
  it("respond 和 recover 展开时不泄露原始结构", () => {
    const result = { content: [{ type: "text", text: '{"workerId":"w"}' }], details: { result: { workerId: "w", requestId: "r", state: "waiting" } } };
    for (const kind of ["respond", "recover"] as const) {
      const expanded = humanizeToolResult(kind, result, true);
      expect(expanded).toContain("worker：w");
      expect(expanded).not.toContain("{");
      expect(expanded).not.toContain('"workerId"');
    }
  });

  it("wait 默认摘要，展开显示人类可读 worker、request 与 pending", () => {
    const result = {
      content: [{ type: "text", text: '{"reason":"worker_event"}' }],
      details: { result: {
        reason: "worker_event",
        ready: [{ id: "w1", title: "检查", state: "completed", requestedTier: "T3", activeTier: "T3", fallbackTrail: [], activeTools: [], report: { summary: "发现入口", facts: [] } }],
        requests: [{ workerId: "w2", requestId: "r2", kind: "request_context", payload: { question: "ignored" } }],
        pendingWorkerIds: ["w3"],
      } },
    };
    expect(humanizeToolResult("wait", result, false)).toContain("已就绪 1 · 仍等待 1");
    const expanded = humanizeToolResult("wait", result, true);
    expect(expanded).toContain("检查 · w1 · completed");
    expect(expanded).toContain("报告：发现入口");
    expect(expanded).toContain("需要回应 · w2 · request_context · request r2");
    expect(expanded).toContain("仍等待：w3");
    expect(expanded).not.toContain("{");
  });
});
