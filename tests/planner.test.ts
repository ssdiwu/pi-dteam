/**
 * planner.test.ts — 测试 src/planner.ts 的核心逻辑
 *
 * 覆盖：
 *  - quickRuleBasedPlan（通过 plan() 间接测，因为它是未导出函数）
 *  - normalizeMode / normalizeRole / normalizeStrategy（通过 LLM 路径间接测）
 *  - extractJSON（通过 LLM 路径间接测）
 *  - LLM fallback
 *
 * 策略：
 *  - mock 掉 ../src/session.js，拦截 createWorkerSession 和 pickAvailableModel
 *  - 规则判断路径不调 LLM：验证 createWorkerSession 没被调用 + 返回 plan 结构
 *  - 复杂路径：mock createWorkerSession 返回一个带可控 messages 的 session
 */

// ═══ mock session.js（planner 唯一外部依赖） ═══
const { mockCreateWorkerSession, mockPickAvailableModel, mockListAvailableTools, mockFormatToolsForPrompt } = vi.hoisted(() => ({
  mockCreateWorkerSession: vi.fn(),
  mockPickAvailableModel: vi.fn(() => "minimax-cn/MiniMax-M3"),
  mockListAvailableTools: vi.fn(async () => [
    { name: "tinyfish_search", description: "联网搜索", source: "tinyfish" },
    { name: "tinyfish_fetch", description: "抓取网页", source: "tinyfish" },
    { name: "read", description: "读文件", source: "pi-builtin" },
  ]),
  mockFormatToolsForPrompt: vi.fn((tools: any[]) =>
    tools.length === 0
      ? "（无）"
      : tools.map(t => t.description ? `- ${t.name}: ${t.description}` : `- ${t.name}`).join("\n"),
  ),
}));

vi.mock("../src/session.js", () => ({
  pickAvailableModel: mockPickAvailableModel,
  createWorkerSession: mockCreateWorkerSession,
  getRoleTools: vi.fn(),
}));

// ═══ mock session/discovery.js（避免在测试里真调 discoverAndLoadExtensions） ═══
vi.mock("../src/session/discovery.js", () => ({
  listAvailableTools: mockListAvailableTools,
  formatToolsForPrompt: mockFormatToolsForPrompt,
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { plan } from "../src/planner.js";
import type { ExecutionPlan, RoleName, Strategy } from "../src/tools.js";

/** 构造一个会走 LLM 路径的 goal（25+ 字符，所有关键词都不命中） */
const LLM_TRIGGER_GOAL = "A generic task with no special keywords here at all ever";

/** 构造一个带 LLM 响应的 fake session */
function fakeSessionWithText(text: string): any {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    messages: [
      { role: "user", content: [{ type: "text", text: "目标：" }] },
      { role: "assistant", content: [{ type: "text", text }] },
    ],
  };
}

beforeEach(() => {
  mockCreateWorkerSession.mockReset();
  mockPickAvailableModel.mockReset().mockReturnValue("minimax-cn/MiniMax-M3");
  mockListAvailableTools.mockReset().mockResolvedValue([
    { name: "tinyfish_search", description: "联网搜索", source: "tinyfish" },
    { name: "tinyfish_fetch", description: "抓取网页", source: "tinyfish" },
    { name: "read", description: "读文件", source: "pi-builtin" },
  ] as any);
  mockFormatToolsForPrompt.mockReset().mockImplementation((tools: any[]) =>
    tools.length === 0
      ? "（无）"
      : tools.map((t: any) => t.description ? `- ${t.name}: ${t.description}` : `- ${t.name}`).join("\n"),
  );
});

// ═══ quickRuleBasedPlan（通过 plan() 间接测，规则命中不调 LLM） ═══

describe("quickRuleBasedPlan（规则判断，零 LLM 成本）", () => {
  it("空 goal → solo + build + direct（'空目标'）", async () => {
    const result = await plan("", { cwd: "/tmp" });
    expect(result).toEqual({
      mode: "solo",
      reason: "空目标",
      steps: [{ role: "build", task: "", strategy: "direct" }],
    });
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("纯空白 goal（trim 后空）→ solo + build + direct", async () => {
    const result = await plan("   ", { cwd: "/tmp" });
    expect(result.mode).toBe("solo");
    expect(result.steps[0].strategy).toBe("direct");
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("短 goal（< 25 字符） → solo + build + direct", async () => {
    const result = await plan("写 hello world", { cwd: "/tmp" });
    expect(result).toMatchObject({
      mode: "solo",
      reason: "目标简短，直接干",
      steps: [{ role: "build", task: "写 hello world", strategy: "direct" }],
    });
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("短 goal 即使含编码词 → solo + build + direct（短目标优先）", async () => {
    const result = await plan("写代码", { cwd: "/tmp" });
    expect(result.mode).toBe("solo");
    expect(result.steps[0].role).toBe("build");
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("并行 + 编码 + 非探索 → team + build + build_check", async () => {
    const goal = "同时实现用户模块、订单模块和支付模块三个独立的功能函数";
    const result = await plan(goal, { cwd: "/tmp" });
    expect(result).toMatchObject({
      mode: "team",
      reason: "检测到并行特征",
      steps: [{ role: "build", task: goal, strategy: "build_check" }],
    });
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("并行 + 编码 + 含探索词 → 不走 team 分支（isExploratory 为 true）", async () => {
    // "并行" 触发 + "实现" 触发 + "探索" 触发 → team 条件要求 !isExploratory → 不命中
    // 但 isCoding 命中 → 进 chain 分支
    const goal = "同时并行实现两个完整功能，并探索一下相关代码项目结构";
    const result = await plan(goal, { cwd: "/tmp" });
    expect(result.mode).toBe("chain");
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("编码 + 非验证 + 非自适应 → chain(explore→build) + build_check", async () => {
    const goal = "实现一个完整的用户登录功能，包括前后端代码模块和用户管理界面";
    const result = await plan(goal, { cwd: "/tmp" });
    expect(result).toMatchObject({
      mode: "chain",
      reason: "编码任务：先探索再实现再验证",
      steps: [
        { role: "explore", strategy: "direct" },
        { role: "build", strategy: "build_check" },
      ],
    });
    expect(result.steps[1].task).toBe(goal);
    expect(result.steps[0].task).toContain("探索项目现状");
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("编码 + 非验证 + 自适应 → chain(explore→build) + adaptive", async () => {
    const goal = "实现一个完整的登录功能，要求持续优化改进直到满意为止的最终版本";
    const result = await plan(goal, { cwd: "/tmp" });
    expect(result).toMatchObject({
      mode: "chain",
      reason: "需要迭代优化",
      steps: [
        { role: "explore", strategy: "direct" },
        { role: "build", strategy: "adaptive" },
      ],
    });
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("编码 + 含验证词 → 不走 chain 分支（isVerification 为 true，验证分支优先）", async () => {
    // isCoding && !isVerification 才能进 chain 分支
    // "实现" + "测试" → isCoding && isVerification → chain 不命中 → null
    // 然后 !isCoding 不命中（isCoding 为 true），!isCoding && isExploratory 不命中
    // !isCoding && isVerification 不命中（isCoding 为 true）→ return null
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","reason":"x","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    const goal = "实现一个新功能，给现有代码添加自动化测试用例覆盖主要业务逻辑";
    const result = await plan(goal, { cwd: "/tmp" });
    // 因为是 null，应该走 LLM
    expect(mockCreateWorkerSession).toHaveBeenCalled();
    expect(result.mode).toBe("solo");
  });

  it("纯探索（无编码词）→ solo + explore + direct", async () => {
    const goal = "调研一下 React 的最新版本，看看到底有哪些新特性";
    const result = await plan(goal, { cwd: "/tmp" });
    expect(result).toMatchObject({
      mode: "solo",
      reason: "纯探索任务",
      steps: [{ role: "explore", strategy: "direct" }],
    });
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("纯验证（无编码词）→ solo + check + direct", async () => {
    const goal = "请运行 tsc 验证类型检查，并跑测试确认所有测试都通过";
    const result = await plan(goal, { cwd: "/tmp" });
    expect(result).toMatchObject({
      mode: "solo",
      reason: "纯验证任务",
      steps: [{ role: "check", strategy: "direct" }],
    });
    expect(mockCreateWorkerSession).not.toHaveBeenCalled();
  });

  it("都不命中（25+ 字符、5 个 regex 都不匹配）→ 返回 null → 走 LLM", async () => {
    // LLM_TRIGGER_GOAL = "A generic task with no special keywords here at all ever"
    // 长度 49，5 个 regex 都不命中
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","reason":"test","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    const result = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(mockCreateWorkerSession).toHaveBeenCalled();
    expect(result.mode).toBe("solo");
  });

  it("英文 + 25+ 字符：'A very long English task description without any keywords'", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"chain","reason":"","steps":[]}'),
    );
    const result = await plan(
      "A very long English task description without any keywords",
      { cwd: "/tmp" },
    );
    expect(mockCreateWorkerSession).toHaveBeenCalled();
    // 空 steps → fallback 单步
    expect(result.steps).toHaveLength(1);
    expect(result.steps[0].role).toBe("build");
  });
});

// ═══ normalize*（通过 LLM 路径间接测） ═══

describe("normalizeMode（LLM 路径）", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  function planWith(mode: string): Promise<ExecutionPlan> {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText(
        `{"mode":"${mode}","reason":"","steps":[{"role":"build","task":"x","strategy":"direct"}]}`,
      ),
    );
    return plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
  }

  it("'chain' → chain", async () => {
    const r = await planWith("chain");
    expect(r.mode).toBe("chain");
  });

  it("'team' → team", async () => {
    const r = await planWith("team");
    expect(r.mode).toBe("team");
  });

  it("'solo' → solo", async () => {
    const r = await planWith("solo");
    expect(r.mode).toBe("solo");
  });

  it("'unknown_mode' → solo（默认）", async () => {
    const r = await planWith("unknown_mode");
    expect(r.mode).toBe("solo");
  });

  it("'CHAIN'（大写）→ chain（toLowerCase 归一化）", async () => {
    const r = await planWith("CHAIN");
    expect(r.mode).toBe("chain");
  });

  it("缺 mode → solo（默认）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"reason":"no mode","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.mode).toBe("solo");
  });
});

describe("normalizeRole（LLM 路径）", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  function planWith(role: string): Promise<ExecutionPlan> {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText(
        `{"mode":"chain","reason":"","steps":[{"role":"${role}","task":"x","strategy":"direct"}]}`,
      ),
    );
    return plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
  }

  it("'explore' → explore", async () => {
    expect((await planWith("explore")).steps[0].role).toBe("explore");
  });

  it("'design' → design", async () => {
    expect((await planWith("design")).steps[0].role).toBe("design");
  });

  it("'build' → build", async () => {
    expect((await planWith("build")).steps[0].role).toBe("build");
  });

  it("'check' → check", async () => {
    expect((await planWith("check")).steps[0].role).toBe("check");
  });

  it("'close' → close", async () => {
    expect((await planWith("close")).steps[0].role).toBe("close");
  });

  it("'explorer' → explore（'explor' 子串匹配）", async () => {
    expect((await planWith("explorer")).steps[0].role).toBe("explore");
  });

  it("'review' → check（review → check）", async () => {
    expect((await planWith("review")).steps[0].role).toBe("check");
  });

  it("'验收' → check（中文 → check）", async () => {
    expect((await planWith("验收")).steps[0].role).toBe("check");
  });

  it("'实现' → build（中文 → build）", async () => {
    expect((await planWith("实现")).steps[0].role).toBe("build");
  });

  it("'探索' → explore（中文 → explore）", async () => {
    expect((await planWith("探索")).steps[0].role).toBe("explore");
  });

  it("'方案' → design（中文 → design）", async () => {
    expect((await planWith("方案")).steps[0].role).toBe("design");
  });

  it("'收口' → close（中文 → close）", async () => {
    expect((await planWith("收口")).steps[0].role).toBe("close");
  });

  it("'unknown_role_xyz' → build（默认）", async () => {
    expect((await planWith("unknown_role_xyz")).steps[0].role).toBe("build");
  });

  it("'Build'（首字母大写）→ build（toLowerCase 后命中）", async () => {
    expect((await planWith("Build")).steps[0].role).toBe("build");
  });
});

describe("normalizeStrategy（LLM 路径）", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  function planWith(strategy: string): Promise<ExecutionPlan> {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText(
        `{"mode":"chain","reason":"","steps":[{"role":"build","task":"x","strategy":"${strategy}"}]}`,
      ),
    );
    return plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
  }

  it("'build_check' → build_check", async () => {
    expect((await planWith("build_check")).steps[0].strategy).toBe("build_check");
  });

  it("'build-check'（中划线）→ build_check", async () => {
    expect((await planWith("build-check")).steps[0].strategy).toBe("build_check");
  });

  it("'建检'（中文）→ build_check", async () => {
    expect((await planWith("建检")).steps[0].strategy).toBe("build_check");
  });

  it("'adaptive' → adaptive", async () => {
    expect((await planWith("adaptive")).steps[0].strategy).toBe("adaptive");
  });

  it("'自适应'（中文）→ adaptive", async () => {
    expect((await planWith("自适应")).steps[0].strategy).toBe("adaptive");
  });

  it("'迭代'（中文）→ adaptive", async () => {
    expect((await planWith("迭代")).steps[0].strategy).toBe("adaptive");
  });

  it("'direct' → direct", async () => {
    expect((await planWith("direct")).steps[0].strategy).toBe("direct");
  });

  it("'unknown_strategy' → direct（默认）", async () => {
    expect((await planWith("unknown_strategy")).steps[0].strategy).toBe("direct");
  });
});

// ═══ extractJSON（通过 LLM 路径间接测） ═══

describe("extractJSON（LLM 路径）", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  it("JSON 在 ```json 代码块中 → 解析成功", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText(
        '好的，这是计划：\n```json\n{"mode":"chain","reason":"test","steps":[{"role":"build","task":"x","strategy":"direct"}]}\n```\n完成。',
      ),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.mode).toBe("chain");
    expect(r.reason).toBe("test");
    expect(r.steps[0].role).toBe("build");
  });

  it("JSON 在 ``` 代码块（无语言标识）→ 解析成功", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText(
        '```\n{"mode":"team","reason":"x","steps":[{"role":"build","task":"x","strategy":"direct"}]}\n```',
      ),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.mode).toBe("team");
  });

  it("JSON 嵌入在文本中（无代码块）→ 切片解析", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText(
        '我建议这样：{"mode":"solo","reason":"simple","steps":[{"role":"build","task":"x","strategy":"direct"}]} 这样的方案最合适。',
      ),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.mode).toBe("solo");
    expect(r.reason).toBe("simple");
  });

  it("无 JSON 内容 → fallback（solo + build + direct）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText("我没有想出合适的计划，你自己看着办吧。"),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r).toEqual({
      mode: "solo",
      reason: "LLM 未返回有效 JSON，fallback",
      steps: [{ role: "build", task: LLM_TRIGGER_GOAL, strategy: "direct" }],
    });
  });

  it("JSON 格式不合法 → fallback", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('```json\n{ invalid json format }\n```'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.mode).toBe("solo");
    expect(r.reason).toContain("fallback");
  });

  it("只有 { 没有 } → fallback", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('只有 { 没有闭合'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.mode).toBe("solo");
    expect(r.reason).toContain("fallback");
  });

  it("空 steps 数组 → 单步 fallback（role=build, strategy=direct）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"chain","reason":"x","steps":[]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.mode).toBe("chain");
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].role).toBe("build");
    expect(r.steps[0].strategy).toBe("direct");
    expect(r.steps[0].task).toBe(LLM_TRIGGER_GOAL);
  });

  it("多步 steps → 全部保留", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText(
        '{"mode":"chain","reason":"multi","steps":[{"role":"explore","task":"a","strategy":"direct"},{"role":"build","task":"b","strategy":"build_check"}]}',
      ),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.steps).toHaveLength(2);
    expect(r.steps[0].role).toBe("explore");
    expect(r.steps[1].role).toBe("build");
    expect(r.steps[1].strategy).toBe("build_check");
  });

  it("缺 reason → 空字符串", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.reason).toBe("");
  });

  it("缺 task → 使用 goal 作为 fallback task", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","strategy":"direct"}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.steps[0].task).toBe(LLM_TRIGGER_GOAL);
  });

  it("steps 不是数组 → 当作空数组处理（单步 fallback）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":"not an array"}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.steps).toHaveLength(1);
    expect(r.steps[0].role).toBe("build");
  });
});

// ═══ 消息提取（取最后一条 assistant 的 text） ═══

describe("消息提取（取最后一条 assistant text）", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  it("多条 assistant 消息 → 取最后一条的 text", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn(),
      messages: [
        { role: "assistant", content: [{ type: "text", text: "old plan" }] },
        { role: "user", content: [{ type: "text", text: "再想想" }] },
        { role: "assistant", content: [{ type: "text", text: '{"mode":"team","reason":"new","steps":[]}' }] },
      ],
    });
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.reason).toBe("new");
    expect(r.mode).toBe("team");
  });

  it("assistant content 含多个 part → 取第一个 text part", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn(),
      messages: [
        { role: "assistant", content: [
          { type: "text", text: '{"mode":"solo","reason":"first","steps":[]}' },
          { type: "text", text: '{"mode":"team","reason":"second","steps":[]}' },
        ]},
      ],
    });
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.reason).toBe("first");
  });

  it("assistant content 含 toolCall 等非 text part → 跳过", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn(),
      messages: [
        { role: "assistant", content: [
          { type: "toolCall", name: "x", arguments: {} },
          { type: "text", text: '{"mode":"solo","reason":"after-tool","steps":[]}' },
        ]},
      ],
    });
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.reason).toBe("after-tool");
  });

  it("content 不是数组 → 跳过", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn(),
      messages: [
        { role: "assistant", content: "plain string content" },
        { role: "assistant", content: [{ type: "text", text: '{"mode":"solo","reason":"after","steps":[]}' }] },
      ],
    });
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.reason).toBe("after");
  });

  it("无 assistant 消息 → fallback（无 text 可提取）", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn(),
      messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }],
    });
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.reason).toContain("fallback");
    expect(r.mode).toBe("solo");
  });
});

// ═══ createWorkerSession 调用参数 ═══

describe("createWorkerSession 调用", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  it("LLM 路径时 pickAvailableModel 被调用", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(mockPickAvailableModel).toHaveBeenCalledTimes(1);
  });

  it("ctx.cwd 优先于 process.cwd()", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, { cwd: "/my/cwd" });
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.cwd).toBe("/my/cwd");
  });

  it("ctx 没 cwd → 用 process.cwd()", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, {});  // 无 cwd
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.cwd).toBe(process.cwd());
  });

  it("systemPrompt 传给 createWorkerSession", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("dteam 的规划器");
    expect(callArgs.systemPrompt).toContain("JSON");
  });

  it("modelStr 来自 pickAvailableModel 的返回值", async () => {
    mockPickAvailableModel.mockReturnValue("custom-provider/custom-model");
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.modelStr).toBe("custom-provider/custom-model");
  });

  it("ctx 透传给 createWorkerSession", async () => {
    const ctx = { cwd: "/tmp", model: "x", custom: "field" };
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, ctx);
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.ctx).toBe(ctx);
  });
});

// ═══ step.tools 解析（0.4.1 候选） ═══

describe("step.tools 解析（0.4.1 候选）", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  it("LLM 返回 tools 数组 → 保留全部（若都在 available 中）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"chain","steps":[{"role":"explore","task":"搜","strategy":"direct","tools":["tinyfish_search","read"]},{"role":"build","task":"干","strategy":"direct","tools":["read"]}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.steps[0].tools).toEqual(["tinyfish_search", "read"]);
    expect(r.steps[1].tools).toEqual(["read"]);
  });

  it("LLM 返回 tools 拼错 → intersect 过滤掉不存在的", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"explore","task":"搜","strategy":"direct","tools":["tinyfsh_search","read","nonexistent"]}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    // tinyfsh_search 是拼错，nonexistent 不存在；只有 read 保留
    expect(r.steps[0].tools).toEqual(["read"]);
  });

  it("LLM 返回 tools 全部拼错 → 降级为 undefined（不报 createAgentSession 错误）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"explore","task":"搜","strategy":"direct","tools":["tinyfsh_search","fictional"]}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    // 全部被过滤掉 → tools 字段不设 → 后续走 ROLE_DEFAULTS
    expect(r.steps[0].tools).toBeUndefined();
  });

  it("LLM 不填 tools → tools 字段不设", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.steps[0].tools).toBeUndefined();
  });

  it("LLM 返回 tools: []（空数组）→ 视为未填", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct","tools":[]}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.steps[0].tools).toBeUndefined();
  });

  it("LLM 返回 tools 含非字符串 → 过滤掉非字符串", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct","tools":["read",123,null,"tinyfish_search"]}]}'),
    );
    const r = await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    expect(r.steps[0].tools).toEqual(["read", "tinyfish_search"]);
  });

  it("systemPrompt 含 formatted tools 块", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("已加载的工具");
    expect(callArgs.systemPrompt).toContain("tinyfish_search: 联网搜索");
  });

  it("无扩展加载时 systemPrompt 仍含清单（占位'（无）'）", async () => {
    mockListAvailableTools.mockResolvedValueOnce([]);
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithText('{"mode":"solo","steps":[{"role":"build","task":"x","strategy":"direct"}]}'),
    );
    await plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" });
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("（无）");
  });
});

// ═══ 错误传播 ═══

describe("错误处理", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
  });

  it("createWorkerSession 抛错 → plan 向上传播（不捕获）", async () => {
    mockCreateWorkerSession.mockRejectedValue(new Error("session 创建失败"));
    await expect(plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" })).rejects.toThrow("session 创建失败");
  });

  it("session.prompt 抛错 → plan 向上传播", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn().mockRejectedValue(new Error("prompt 失败")),
      messages: [],
    });
    await expect(plan(LLM_TRIGGER_GOAL, { cwd: "/tmp" })).rejects.toThrow("prompt 失败");
  });
});
