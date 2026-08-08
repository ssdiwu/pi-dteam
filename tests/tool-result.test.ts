import { describe, expect, it } from "bun:test";
import { humanizeToolResult } from "../src/tui/tool-result.js";
import { workerReport } from "./worker-report.fixture.js";

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

  it("control 展开显示主动动作、取消来源和写入守卫", () => {
    const result = humanizeToolResult("control", {
      details: {
        result: { workerId: "w", action: "cancel", state: "cancelled", cancelInitiator: "main", writeInterrupted: { reason: "主代理接管", writeScope: ["src/"] } },
        action: { action: "cancel", reason: "主代理接管" },
      },
    }, true);
    expect(result).toContain("已控制 worker · cancel · cancelled");
    expect(result).toContain("停止：强制取消（主代理接管）");
    expect(result).toContain("取消发起方：main");
    expect(result).toContain("写入守卫：src/ · 原因：主代理接管");
    expect(result).not.toContain("{");
  });

  it("wait 默认摘要，展开显示人类可读 worker、request 与 pending", () => {
    const result = {
      content: [{ type: "text", text: '{"reason":"worker_event"}' }],
      details: { result: {
        reason: "worker_event",
        targetWorkers: [{ id: "w1", title: "检查" }, { id: "w2", title: "等待上下文" }],
        waitedMs: 1_250,
        timeoutMs: 60_000,
        events: [
          { type: "finding", workerId: "w1", title: "检查", payload: { findings: [{ summary: "影响 B", evidence: "src/a.ts:4", impact: "B 改走安全路径" }, { summary: "第二发现", evidence: "src/b.ts:8", impact: "需要 T2 复核" }] } },
          { type: "write_interrupted", workerId: "w1", title: "检查", payload: { reason: "worker failed", writeScope: ["src/runtime/"] } },
        ],
        ready: [{ id: "w1", title: "检查", state: "completed", requestedTier: "T3", activeTier: "T3", fallbackTrail: [], activeTools: [], writeScope: ["src/runtime/"], report: workerReport({
          summary: "发现入口",
          activities: ["inspected", "tested"],
          facts: [{ claim: "入口存在", evidence: "src/index.ts:1" }],
          verification: { depth: "automated", status: "partial", evidence: ["npm test 通过"], remaining: ["未做运行时复测"] },
          uncertainties: ["真实 provider \u001b[31m未验证"],
        }) }],
        requests: [{ workerId: "w2", requestId: "r2", kind: "request_context", payload: { question: "ignored" } }],
        pendingWorkerIds: ["w3"],
      } },
    };
    const compact = humanizeToolResult("wait", result, false);
    expect(compact).toContain("检查 (w1)、等待上下文 (w2)");
    expect(compact).toContain("已等 1.3s / 最多 1m0s");
    expect(compact).toContain("本轮返回 1 · 本轮无事件 1");
    const expanded = humanizeToolResult("wait", result, true);
    expect(expanded).toContain("事件 · w1 · write_interrupted · 写入范围：src/runtime/ · 原因：worker failed");
    expect(expanded).toContain("事件 · w1 · finding · 摘要：影响 B · 证据：src/a.ts:4 · 影响：B 改走安全路径");
    expect(expanded).toContain("摘要：第二发现 · 证据：src/b.ts:8 · 影响：需要 T2 复核");
    expect(expanded).toContain("检查 · w1 · completed");
    expect(expanded).toContain("本 worker 写入范围：src/runtime/（不代表父任务完成）");
    expect(expanded).toContain("报告：completed · 发现入口");
    expect(expanded).toContain("动作：inspected、tested");
    expect(expanded).toContain("验证：automated / partial");
    expect(expanded).toContain("证据：npm test 通过");
    expect(expanded).toContain("剩余：未做运行时复测");
    expect(expanded).toContain("事实：入口存在 ← src/index.ts:1");
    expect(expanded).toContain("不确定：真实 provider �[31m未验证");
    expect(expanded).not.toContain("\u001b");
    expect(expanded).toContain("需要回应 · w2 · request_context · request r2 · 请提供：ignored");
    expect(expanded).toContain("本轮无事件：w3");
    expect(expanded).not.toContain("{");
  });
});
