/**
 * orchestrator-loop.ts 测试（Phase 1）
 *
 * 用 vi.mock 替换 createWorkerSession + leaf.execute，模拟 Orchestrator LLM
 * 和 worker 的返回，验证：
 *  - summon → check → done 的正常流转
 *  - Completion Gate：跳过 check 直接 done 会被强制回 check
 *  - check reject 后继续修复
 *  - maxRounds 防死循环
 *  - maxCheckRetries 收口失败
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// 控制序列
let orchestratorSequence: string[] = [];
let workerSequence: string[] = [];

// Orchestrator session：prompt 时从序列取一个文本作为 assistant 输出
function makeMockSession() {
  const messages: any[] = [];
  return {
    prompt: vi.fn(async (userPrompt: string) => {
      const text = orchestratorSequence.shift() ?? '{"type":"fail","reason":"序列耗尽"}';
      messages.push({ role: "user", content: [{ type: "text", text: userPrompt }] });
      messages.push({ role: "assistant", content: [{ type: "text", text }] });
    }),
    messages,
  };
}

vi.mock("../src/session.js", () => ({
  createWorkerSession: vi.fn(async () => makeMockSession()),
  pickAvailableModel: vi.fn(() => "test/test"),
}));

vi.mock("../src/leaf.js", () => ({
  execute: vi.fn(async () => workerSequence.shift() ?? "(no output)"),
}));

import { runLoop } from "../src/orchestrator-loop.js";

describe("orchestrator-loop (Phase 1)", () => {
  beforeEach(() => {
    orchestratorSequence = [];
    workerSequence = [];
    vi.clearAllMocks();
  });

  const fakeCtx = () => ({
    cwd: process.cwd(),
    modelRegistry: { find: () => ({ id: "test" }) },
  });

  it("summon → check → done 正常流转", async () => {
    orchestratorSequence = [
      JSON.stringify({ type: "summon", role: "explore", task: "探索代码", reason: "先了解现状" }),
      JSON.stringify({ type: "summon", role: "build", task: "实现功能", reason: "已了解" }),
      JSON.stringify({ type: "check", task: "验证实现", reason: "主体完成" }),
      JSON.stringify({ type: "done", reason: "目标达成" }),
    ];
    workerSequence = [
      "探索完成，发现 3 个文件",
      "实现完成",
      '```json\n{"passed":true,"issues":[]}\n```',
    ];

    const result = await runLoop("实现 X 功能", fakeCtx());

    expect(result.status).toBe("done");
    expect(result.summonTrail).toHaveLength(3);
    expect(result.summonTrail.map(s => s.role)).toEqual(["explore", "build", "check"]);
    expect(result.checkConclusion.passed).toBe(true);
    expect(result.summonTrail[2].role).toBe("check");
  });

  it("Completion Gate：跳过 check 直接 done 会被强制回 check", async () => {
    orchestratorSequence = [
      JSON.stringify({ type: "summon", role: "build", task: "实现", reason: "开始" }),
      JSON.stringify({ type: "done", reason: "我完成了" }), // 违规
      JSON.stringify({ type: "check", task: "验证", reason: "强制收口" }),
      JSON.stringify({ type: "done", reason: "目标达成" }),
    ];
    workerSequence = [
      "实现完成",
      '```json\n{"passed":true}\n```',
    ];

    const result = await runLoop("实现 Y", fakeCtx());

    expect(result.status).toBe("done");
    expect(result.summonTrail.some(s => s.role === "check")).toBe(true);
    expect(result.checkConclusion.passed).toBe(true);
  });

  it("check reject 后继续修复，第二次 check 通过", async () => {
    orchestratorSequence = [
      JSON.stringify({ type: "summon", role: "build", task: "实现", reason: "开始" }),
      JSON.stringify({ type: "check", task: "验证", reason: "收口尝试1" }),
      JSON.stringify({ type: "summon", role: "build", task: "修复问题", reason: "check 发现问题" }),
      JSON.stringify({ type: "check", task: "再验证", reason: "收口尝试2" }),
      JSON.stringify({ type: "done", reason: "目标达成" }),
    ];
    workerSequence = [
      "实现完成",
      '```json\n{"passed":false,"issues":["测试失败"]}\n```',
      "修复完成",
      '```json\n{"passed":true}\n```',
    ];

    const result = await runLoop("实现 Z", fakeCtx());

    expect(result.status).toBe("done");
    expect(result.summonTrail.filter(s => s.role === "check")).toHaveLength(2);
    expect(result.checkConclusion.passed).toBe(true);
    expect(result.checkConclusion.round).toBe(2);
  });

  it("maxCheckRetries 超限 → 失败收口", async () => {
    orchestratorSequence = [
      JSON.stringify({ type: "summon", role: "build", task: "实现", reason: "开始" }),
      JSON.stringify({ type: "check", task: "验证1", reason: "尝试1" }),
      JSON.stringify({ type: "summon", role: "build", task: "修1", reason: "问题1" }),
      JSON.stringify({ type: "check", task: "验证2", reason: "尝试2" }),
      JSON.stringify({ type: "summon", role: "build", task: "修2", reason: "问题2" }),
      JSON.stringify({ type: "check", task: "验证3", reason: "尝试3" }),
    ];
    workerSequence = [
      "实现完成",
      '{"passed":false,"issues":["1"]}',
      "修1",
      '{"passed":false,"issues":["2"]}',
      "修2",
      '{"passed":false,"issues":["3"]}',
    ];

    const result = await runLoop("实现 W", fakeCtx(),
      { maxRounds: 15, maxCheckRetries: 3, decisionTimeoutMs: 60_000 });

    expect(result.status).toBe("failed");
    expect(result.checkConclusion.passed).toBe(false);
    expect(result.checkConclusion.round).toBe(3);
    expect(result.summary).toContain("最大重试");
  });

  it("maxRounds 超限 → 失败收口（防死循环）", async () => {
    orchestratorSequence = Array.from({ length: 20 }, () =>
      JSON.stringify({ type: "summon", role: "explore", task: "继续探索", reason: "还没完" }));
    workerSequence = Array.from({ length: 20 }, () => "继续探索");

    const result = await runLoop("无限探索", fakeCtx(),
      { maxRounds: 3, maxCheckRetries: 3, decisionTimeoutMs: 60_000 });

    expect(result.status).toBe("failed");
    expect(result.summonTrail.length).toBeLessThanOrEqual(3);
    expect(result.summary).toContain("最大召唤轮次");
  });

  it("fail 决策 → 立即失败收口", async () => {
    orchestratorSequence = [
      JSON.stringify({ type: "summon", role: "build", task: "试一下", reason: "开始" }),
      JSON.stringify({ type: "fail", reason: "无法继续，缺关键依赖" }),
    ];
    workerSequence = ["试了，但缺依赖"];

    const result = await runLoop("不可能的任务", fakeCtx());

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("无法继续");
  });

  it("Orchestrator 返回非法 JSON → fail 兜底", async () => {
    orchestratorSequence = ["这不是 JSON"];
    workerSequence = [];

    const result = await runLoop("测试", fakeCtx());

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("未返回有效 JSON");
  });
});
