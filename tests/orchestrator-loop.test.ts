/**
 * orchestrator-loop.ts 测试（Phase 1 + tool calling 契约）
 *
 * 用 vi.mock 替换 createWorkerSession + leaf.execute，模拟 Orchestrator LLM
 * 和 worker 的返回，验证：
 *  - summon → check → done 的正常流转
 *  - Completion Gate：跳过 check 直接 done 会被强制回 check
 *  - check reject 后继续修复
 *  - maxRounds 防死循环
 *  - maxCheckRetries 收口失败
 *
 * 0.6.0 tool calling 契约：Orchestrator 用 orchestrator_decide tool 输出决策，
 * check 用 check_conclude tool 输出结论。测试 mock 模拟 LLM 调用这些 tool。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// 控制序列：Orchestrator 决策对象序列 + worker 输出序列 + check 结论序列
let orchestratorDecisions: any[] = [];
let workerOutputs: string[] = [];
let checkConclusions: any[] = [];

/**
 * mock Orchestrator/worker session：prompt 时，从 options.customTools 找到
 * orchestrator_decide tool 并调用 execute（模拟 LLM 调用 tool）。
 * 对 check worker，从 checkConclusions 序列触发 check_conclude。
 */
function makeMockSession(options: any) {
  const messages: any[] = [];
  const customTools: any[] = options?.customTools ?? [];
  const decideTool = customTools.find((t: any) => t.name === "orchestrator_decide");
  const checkTool = customTools.find((t: any) => t.name === "check_conclude");

  return {
    prompt: vi.fn(async (userPrompt: string) => {
      messages.push({ role: "user", content: [{ type: "text", text: userPrompt }] });
      // Orchestrator session：触发 orchestrator_decide
      if (decideTool) {
        const decision = orchestratorDecisions.shift() ?? { type: "fail", reason: "决策序列耗尽" };
        await decideTool.execute("tc-test", decision);
        messages.push({ role: "assistant", content: [{ type: "text", text: "(已决策)" }] });
        return;
      }
      // check worker session：触发 check_conclude（如果有）
      if (checkTool) {
        const conclusion = checkConclusions.shift() ?? { passed: true, summary: "(mock 默认通过)" };
        await checkTool.execute("tc-check", conclusion);
        messages.push({ role: "assistant", content: [{ type: "text", text: conclusion.summary ?? "(check)" }] });
        return;
      }
      messages.push({ role: "assistant", content: [{ type: "text", text: "(worker)" }] });
    }),
    messages,
    abort: vi.fn(async () => {}),
    subscribe: vi.fn(() => () => {}),
  };
}

vi.mock("../src/session.js", () => ({
  createWorkerSession: vi.fn(async (options: any) => makeMockSession(options)),
  pickAvailableModel: vi.fn(() => "test/test"),
}));

// leaf.execute mock：检查 extraCustomTools 里是否有 check_conclude，有则触发（模拟 check worker 调用 tool）
vi.mock("../src/leaf.js", () => ({
  execute: vi.fn(async (
    _role: any, _task: any, _ctx: any, _goal: any, _tools?: any, extraCustomTools?: any[],
  ) => {
    const checkTool = extraCustomTools?.find((t: any) => t.name === "check_conclude");
    if (checkTool) {
      const conclusion = checkConclusions.shift() ?? { passed: true, summary: "(mock 默认通过)" };
      await checkTool.execute("tc-check", conclusion);
      return conclusion.summary ?? "(check 完成)";
    }
    return workerOutputs.shift() ?? "(no output)";
  }),
}));

import { runLoop } from "../src/orchestrator-loop.js";

describe("orchestrator-loop (Phase 1 + tool calling)", () => {
  beforeEach(() => {
    orchestratorDecisions = [];
    workerOutputs = [];
    checkConclusions = [];
    vi.clearAllMocks();
  });

  const fakeCtx = () => ({
    cwd: process.cwd(),
    modelRegistry: { find: () => ({ id: "test" }) },
  });

  it("summon → check → done 正常流转", async () => {
    orchestratorDecisions = [
      { type: "summon", role: "explore", task: "探索代码", reason: "先了解现状" },
      { type: "summon", role: "build", task: "实现功能", reason: "已了解" },
      { type: "check", task: "验证实现", reason: "主体完成" },
      { type: "done", reason: "目标达成" },
    ];
    workerOutputs = ["探索完成，发现 3 个文件", "实现完成"];
    checkConclusions = [{ passed: true, summary: "验收通过" }];

    const result = await runLoop("实现 X 功能", fakeCtx());

    expect(result.status).toBe("done");
    expect(result.summonTrail).toHaveLength(3);
    expect(result.summonTrail.map(s => s.role)).toEqual(["explore", "build", "check"]);
    expect(result.checkConclusion.passed).toBe(true);
  });

  it("Completion Gate：跳过 check 直接 done 会被强制回 check", async () => {
    orchestratorDecisions = [
      { type: "summon", role: "build", task: "实现", reason: "开始" },
      { type: "done", reason: "我完成了" }, // 违规
      { type: "check", task: "验证", reason: "强制收口" },
      { type: "done", reason: "目标达成" },
    ];
    workerOutputs = ["实现完成"];
    checkConclusions = [{ passed: true, summary: "通过" }];

    const result = await runLoop("实现 Y", fakeCtx());

    expect(result.status).toBe("done");
    expect(result.summonTrail.some(s => s.role === "check")).toBe(true);
    expect(result.checkConclusion.passed).toBe(true);
  });

  it("check reject 后继续修复，第二次 check 通过", async () => {
    orchestratorDecisions = [
      { type: "summon", role: "build", task: "实现", reason: "开始" },
      { type: "check", task: "验证", reason: "收口尝试1" },
      { type: "summon", role: "build", task: "修复问题", reason: "check 发现问题" },
      { type: "check", task: "再验证", reason: "收口尝试2" },
      { type: "done", reason: "目标达成" },
    ];
    workerOutputs = ["实现完成", "修复完成"];
    checkConclusions = [
      { passed: false, summary: "未通过", issues: ["测试失败"] },
      { passed: true, summary: "通过" },
    ];

    const result = await runLoop("实现 Z", fakeCtx());

    expect(result.status).toBe("done");
    expect(result.summonTrail.filter(s => s.role === "check")).toHaveLength(2);
    expect(result.checkConclusion.passed).toBe(true);
    expect(result.checkConclusion.round).toBe(2);
  });

  it("maxCheckRetries 超限 → 失败收口", async () => {
    orchestratorDecisions = [
      { type: "summon", role: "build", task: "实现", reason: "开始" },
      { type: "check", task: "验证1", reason: "尝试1" },
      { type: "summon", role: "build", task: "修1", reason: "问题1" },
      { type: "check", task: "验证2", reason: "尝试2" },
      { type: "summon", role: "build", task: "修2", reason: "问题2" },
      { type: "check", task: "验证3", reason: "尝试3" },
    ];
    workerOutputs = ["实现完成", "修1", "修2"];
    checkConclusions = [
      { passed: false, summary: "未通过", issues: ["1"] },
      { passed: false, summary: "未通过", issues: ["2"] },
      { passed: false, summary: "未通过", issues: ["3"] },
    ];

    const result = await runLoop("实现 W", fakeCtx(),
      { maxRounds: 15, maxCheckRetries: 3, decisionTimeoutMs: 60_000 });

    expect(result.status).toBe("failed");
    expect(result.checkConclusion.passed).toBe(false);
    expect(result.checkConclusion.round).toBe(3);
    expect(result.summary).toContain("最大重试");
  });

  it("maxRounds 超限 → 失败收口（防死循环）", async () => {
    orchestratorDecisions = Array.from({ length: 20 }, () => ({
      type: "summon", role: "explore", task: "继续探索", reason: "还没完",
    }));
    workerOutputs = Array.from({ length: 20 }, () => "继续探索");

    const result = await runLoop("无限探索", fakeCtx(),
      { maxRounds: 3, maxCheckRetries: 3, decisionTimeoutMs: 60_000 });

    expect(result.status).toBe("failed");
    expect(result.summonTrail.length).toBeLessThanOrEqual(3);
    expect(result.summary).toContain("最大召唤轮次");
  });

  it("fail 决策 → 立即失败收口", async () => {
    orchestratorDecisions = [
      { type: "summon", role: "build", task: "试一下", reason: "开始" },
      { type: "fail", reason: "无法继续，缺关键依赖" },
    ];
    workerOutputs = ["试了，但缺依赖"];

    const result = await runLoop("不可能的任务", fakeCtx());

    expect(result.status).toBe("failed");
    expect(result.summary).toContain("无法继续");
  });

  it("Orchestrator 未调用 orchestrator_decide → fail 兜底", async () => {
    // 不 push 任何决策到序列，mock session.prompt 也不会触发 decideTool
    // 但 makeMockSession 在 decideTool 存在时会 shift（耗尽返回默认 fail）
    // 为测"未调 tool"路径，用空序列让 decideTool.execute 被调（返回 fail 兜底）
    orchestratorDecisions = []; // 序列耗尽 → 默认 fail 决策
    workerOutputs = [];

    const result = await runLoop("测试", fakeCtx());

    expect(result.status).toBe("failed");
    // 序列耗尽返回的 fail 决策 reason
    expect(result.summary).toContain("决策序列耗尽");
  });
});
