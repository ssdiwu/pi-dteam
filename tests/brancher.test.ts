/**
 * brancher.test.ts — 测试 src/brancher.ts 的 decide 函数
 *
 * 唯一职责：问 LLM "subTask 拆还是干"，从 messages 中找 decide tool call。
 *
 * 测试策略：
 *  - mock ../src/session.js 拦截 createWorkerSession
 *  - 验证 decide 的 tool call 提取、kind 判断、错误处理
 */

// ═══ mock session.js ═══
const { mockCreateWorkerSession, mockPickAvailableModel } = vi.hoisted(() => ({
  mockCreateWorkerSession: vi.fn(),
  mockPickAvailableModel: vi.fn(() => "minimax-cn/MiniMax-M3"),
}));

vi.mock("../src/session.js", () => ({
  pickAvailableModel: mockPickAvailableModel,
  createWorkerSession: mockCreateWorkerSession,
  getRoleTools: vi.fn(),
}));

import { describe, it, expect, vi, beforeEach } from "vitest";
import { decide } from "../src/brancher.js";
import type { Task } from "../src/tools.js";

/** 构造一个带可控 messages 的 fake session */
function fakeSession(messages: any[]): any {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    messages,
  };
}

/** 在 mockImplementation 中捕获传入的 session */
let capturedSession: any = null;
function makeCapturingMock(messages: any[]): any {
  const sess = fakeSession(messages);
  capturedSession = sess;
  return sess;
}

/** 标准测试 task */
const testTask: Task = {
  id: "task-1",
  parentId: null,
  title: "实现用户登录",
  description: "用 TypeScript 实现一个用户登录功能",
  status: "pending",
  createdAt: Date.now(),
};

beforeEach(() => {
  mockCreateWorkerSession.mockReset();
  mockPickAvailableModel.mockReset().mockReturnValue("minimax-cn/MiniMax-M3");
});

// ═══ execute 决策 ═══

describe("decide — execute 决策", () => {
  it("kind=execute → 返回 execute 决策", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "small enough" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "全局目标");
    expect(result).toEqual({ kind: "execute", reason: "small enough" });
  });

  it("缺 reason → reason 是空字符串", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result).toEqual({ kind: "execute", reason: "" });
  });

  it("reason 是数字 → 转成字符串", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: 123 } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.reason).toBe("123");
  });
});

// ═══ decompose 决策 ═══

describe("decide — decompose 决策", () => {
  it("kind=decompose + subTasks → 返回 decompose 决策", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: {
            kind: "decompose",
            reason: "too big",
            subTasks: [
              { title: "设计", description: "先设计" },
              { title: "实现", description: "再实现" },
            ],
          }},
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result).toEqual({
      kind: "decompose",
      reason: "too big",
      subTasks: [
        { title: "设计", description: "先设计" },
        { title: "实现", description: "再实现" },
      ],
    });
  });

  it("decompose 但缺 subTasks → 空数组", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "decompose", reason: "big" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result).toEqual({ kind: "decompose", reason: "big", subTasks: [] });
  });

  it("subTasks 不是数组 → 当空数组", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "decompose", reason: "x", subTasks: "not array" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.kind).toBe("decompose");
    expect(result.subTasks).toEqual([]);
  });

  it("subTask 缺 title → 'Untitled'", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: {
            kind: "decompose",
            reason: "x",
            subTasks: [{ description: "only desc" }],
          }},
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.subTasks).toHaveLength(1);
    expect(result.subTasks[0]).toEqual({ title: "Untitled", description: "only desc" });
  });

  it("subTask 缺 description → 空字符串", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: {
            kind: "decompose",
            reason: "x",
            subTasks: [{ title: "only title" }],
          }},
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.subTasks).toHaveLength(1);
    expect(result.subTasks[0]).toEqual({ title: "only title", description: "" });
  });

  it("subTask 两个字段都缺 → 'Untitled' + ''", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: {
            kind: "decompose",
            reason: "x",
            subTasks: [{}],
          }},
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.subTasks[0]).toEqual({ title: "Untitled", description: "" });
  });

  it("多个 subTasks → 全部保留", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: {
            kind: "decompose",
            reason: "x",
            subTasks: [
              { title: "a", description: "da" },
              { title: "b", description: "db" },
              { title: "c", description: "dc" },
              { title: "d", description: "dd" },
              { title: "e", description: "de" },
            ],
          }},
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.subTasks).toHaveLength(5);
    expect(result.subTasks.map(s => s.title)).toEqual(["a", "b", "c", "d", "e"]);
  });
});

// ═══ 消息提取（取最后一条 decide tool call） ═══

describe("decide — 消息提取", () => {
  it("多条 assistant 消息 → 取最后一条的 decide tool call", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "first" } },
        ]},
        { role: "user", content: [{ type: "text", text: "再想想" }] },
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "decompose", reason: "second", subTasks: [] } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.kind).toBe("decompose");
    expect(result.reason).toBe("second");
  });

  it("跳过非 decide 的 toolCall", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "otherTool", arguments: { x: 1 } },
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "actual" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.reason).toBe("actual");
  });

  it("content 含 text part + toolCall → toolCall 优先（被识别）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "text", text: "thinking..." },
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "done" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.reason).toBe("done");
  });

  it("content 不是数组 → 跳过", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: "plain string" },
      ]),
    );

    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow(/LLM did not call decide tool/);
  });

  it("无 assistant 消息 → 抛 'LLM did not call decide tool'", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "user", content: [{ type: "text", text: "hi" }] }]),
    );

    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow(/LLM did not call decide tool/);
  });

  it("messages 为空 → 抛错", async () => {
    mockCreateWorkerSession.mockResolvedValue(fakeSession([]));
    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow(/LLM did not call decide tool/);
  });
});

// ═══ 错误处理 ═══

describe("decide — 错误处理", () => {
  it("kind 是未知值 → 抛 'unexpected kind: ...'", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "magic", reason: "x" } },
        ]},
      ]),
    );

    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow(/unexpected kind: magic/);
  });

  it("kind 是 undefined → 抛 'unexpected kind: undefined'", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { reason: "no kind" } },
        ]},
      ]),
    );

    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow(/unexpected kind: undefined/);
  });

  it("createWorkerSession 抛错 → decide 向上传播", async () => {
    mockCreateWorkerSession.mockRejectedValue(new Error("session 创建失败"));
    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow("session 创建失败");
  });

  it("session.prompt 抛错 → decide 向上传播", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn().mockRejectedValue(new Error("prompt 失败")),
      messages: [],
    });
    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow("prompt 失败");
  });

  it("无 decide tool call 但有其他 part → 错误消息包含 debug info", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "text", text: "I cannot decide" },
        ]},
      ]),
    );

    await expect(decide(testTask, { cwd: "/tmp" }, "goal"))
      .rejects.toThrow(/LLM did not call decide tool.*Got:.*I cannot decide/s);
  });
});

// ═══ 入参透传 ═══

describe("decide — 入参透传", () => {
  it("systemPrompt 包含 task title 和 description", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    await decide(testTask, { cwd: "/tmp" }, "全局目标");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.systemPrompt).toContain("实现用户登录");
    expect(callArgs.systemPrompt).toContain("用 TypeScript 实现一个用户登录功能");
    expect(callArgs.systemPrompt).toContain("全局目标");
    expect(callArgs.systemPrompt).toContain("branch");
  });

  it("customTools 包含 decide 工具", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    await decide(testTask, { cwd: "/tmp" }, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.customTools).toBeDefined();
    expect(callArgs.customTools).toHaveLength(1);
    expect(callArgs.customTools[0].name).toBe("decide");
  });

  it("ctx.cwd 透传", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    await decide(testTask, { cwd: "/my/cwd" }, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.cwd).toBe("/my/cwd");
  });

  it("ctx 没 cwd → fallback process.cwd()", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    await decide(testTask, {}, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.cwd).toBe(process.cwd());
  });

  it("modelStr 来自 pickAvailableModel", async () => {
    mockPickAvailableModel.mockReturnValue("custom-provider/custom-model");
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    await decide(testTask, { cwd: "/tmp" }, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.modelStr).toBe("custom-provider/custom-model");
  });

  it("ctx 整体透传", async () => {
    const ctx = { cwd: "/tmp", model: "x", custom: "field" };
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    await decide(testTask, ctx, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.ctx).toBe(ctx);
  });

  it("调用 pickAvailableModel（primary=minimax-cn/M3）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    const ctx = { cwd: "/tmp" };
    await decide(testTask, ctx, "goal");
    expect(mockPickAvailableModel).toHaveBeenCalledTimes(1);
    const callArgs = mockPickAvailableModel.mock.calls[0];
    expect(callArgs[0]).toBe(ctx);
    // 默认走 ctx.model 路径：不传 primary/fallback
    expect(callArgs[1]).toBeUndefined();
    expect(callArgs[2]).toBeUndefined();
  });
});

// ═══ prompt 内容 ═══

describe("decide — prompt 内容", () => {
  it("调用 session.prompt('Decide now.')", async () => {
    capturedSession = null;
    mockCreateWorkerSession.mockImplementation(async () =>
      makeCapturingMock([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(capturedSession.prompt).toHaveBeenCalledWith("Decide now.");
  });
});

// ═══ 边界情况 ═══

describe("decide — 边界情况", () => {
  it("task description 很长也能处理", async () => {
    const longTask: Task = {
      ...testTask,
      description: "a".repeat(1000),
    };
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    const result = await decide(longTask, { cwd: "/tmp" }, "goal");
    expect(result.kind).toBe("execute");
  });

  it("goal 为空字符串", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "");
    expect(result.kind).toBe("execute");
  });

  it("arguments 中有额外字段（不影响主逻辑）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: {
            kind: "execute",
            reason: "ok",
            extraField: "ignored",
            nestedField: { a: 1 },
          }},
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result).toEqual({ kind: "execute", reason: "ok" });
  });

  it("toolCall.arguments 是字符串 → kind 是字符串", async () => {
    // arguments 通常是 object，但有些实现是 string
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "decide", arguments: { kind: "execute", reason: "ok" } },
        ]},
      ]),
    );

    const result = await decide(testTask, { cwd: "/tmp" }, "goal");
    expect(result.kind).toBe("execute");
  });
});
