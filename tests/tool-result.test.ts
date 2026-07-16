import { describe, expect, it } from "vitest";
import { humanizeToolResult } from "../src/tui/tool-result.js";

describe("human-readable tool result projection", () => {
  it("respond 和 recover 展开时显示动作详情且不泄露原始结构", () => {
    const base = { content: [{ type: "text", text: '{"workerId":"w"}' }], result: { workerId: "w", requestId: "r", state: "waiting" } };
    const respond = humanizeToolResult("respond", { ...base, details: { result: base.result, response: { type: "grant_tools", tools: ["read", "grep"] } } }, true);
    expect(respond).toContain("worker：w");
    expect(respond).toContain("回应：grant_tools（read、grep）");
    const recover = humanizeToolResult("recover", { ...base, details: { result: base.result, action: { action: "escalate", tier: "T2" } } }, true);
    expect(recover).toContain("恢复：escalate → T2");
    for (const expanded of [respond, recover]) {
      expect(expanded).not.toContain("{");
      expect(expanded).not.toContain('"workerId"');
    }
  });

  it("wait 默认摘要，展开显示人类可读 worker、request 与 pending", () => {
    const result = {
      content: [{ type: "text", text: '{"reason":"worker_event"}' }],
      details: { result: {
        reason: "worker_event",
        targetWorkers: [{ id: "w1", title: "检查" }, { id: "w2", title: "等待上下文" }],
        waitedMs: 1_250,
        timeoutMs: 60_000,
        ready: [{ id: "w1", title: "检查", state: "completed", requestedTier: "T3", activeTier: "T3", fallbackTrail: [], activeTools: [], report: { summary: "发现入口", facts: [] } }],
        requests: [{ workerId: "w2", requestId: "r2", kind: "request_context", payload: { question: "ignored" } }],
        pendingWorkerIds: ["w3"],
      } },
    };
    const compact = humanizeToolResult("wait", result, false);
    expect(compact).toContain("检查 (w1)、等待上下文 (w2)");
    expect(compact).toContain("已等 1.3s / 最多 1m0s");
    expect(compact).toContain("已就绪 1 · 仍等待 1");
    const expanded = humanizeToolResult("wait", result, true);
    expect(expanded).toContain("检查 · w1 · completed");
    expect(expanded).toContain("报告：发现入口");
    expect(expanded).toContain("需要回应 · w2 · request_context · request r2 · 请提供：ignored");
    expect(expanded).toContain("仍等待：w3");
    expect(expanded).not.toContain("{");
  });
});
