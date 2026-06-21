/**
 * leaf.test.ts — 测试 src/leaf.ts 的 execute 函数
 *
 * 唯一职责：用指定角色调 LLM 执行一个 step。
 *
 * 测试策略：
 *  - mock ../src/session.js 拦截 createWorkerSession 和 pickAvailableModel
 *  - 验证 execute 的输入处理、消息提取、错误传播
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
import { execute } from "../src/leaf.js";

/** 构造一个带可控 messages 的 fake session */
function fakeSession(messages: any[]): any {
  return {
    prompt: vi.fn().mockResolvedValue(undefined),
    messages,
  };
}

/** 构造一个带工具调用计数的 fake session，模拟 maxToolRounds 超限 */
function fakeSessionWithToolCalls(messages: any[], toolCallCount: number, opts?: {
  assistantFinalText?: string;
}): any {
  const finalText = opts?.assistantFinalText ?? "部分结果";
  let listener: ((ev: any) => void) | null = null;
  const session = {
    prompt: vi.fn(async () => {
      // prompt 执行期间，同步触发 toolCallCount 个 tool_execution_end 事件
      if (listener) {
        for (let i = 0; i < toolCallCount; i++) {
          listener({ type: "tool_execution_end", toolCallId: `call-${i + 1}` });
        }
      }
    }),
    abort: vi.fn(async () => {
      messages.push({ role: "assistant", content: [{ type: "text", text: finalText }] });
    }),
    subscribe: vi.fn((l: (ev: any) => void) => {
      listener = l;
      return () => { listener = null; };
    }),
    messages,
  };
  return session;
}

/** 在 mockImplementation 中捕获传入的 session */
let capturedSession: any = null;
function makeCapturingMock(messages: any[]): any {
  const sess = fakeSession(messages);
  capturedSession = sess;
  return sess;
}

beforeEach(() => {
  mockCreateWorkerSession.mockReset();
  mockPickAvailableModel.mockReset().mockReturnValue("minimax-cn/MiniMax-M3");
});

// ═══ 正常路径 ═══

describe("execute — 正常路径", () => {
  it("返回最后一条 assistant 消息的 text", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "user", content: [{ type: "text", text: "做 X" }] },
        { role: "assistant", content: [{ type: "text", text: "已完成 X" }] },
      ]),
    );

    const result = await execute("build", "做 X", { cwd: "/tmp" }, "全局目标");
    expect(result).toBe("已完成 X");
  });

  it("多轮对话：取最后一条 assistant", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "user", content: [{ type: "text", text: "q1" }] },
        { role: "assistant", content: [{ type: "text", text: "old answer" }] },
        { role: "user", content: [{ type: "text", text: "q2" }] },
        { role: "assistant", content: [{ type: "text", text: "new answer" }] },
      ]),
    );

    const result = await execute("build", "q2", { cwd: "/tmp" }, "goal");
    expect(result).toBe("new answer");
  });

  it("content 含多个 part → 取第一个 text", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "text", text: "first text" },
          { type: "text", text: "second text" },
        ]},
      ]),
    );

    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toBe("first text");
  });

  it("content 跳过非 text part（toolCall 等）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "x" },
          { type: "text", text: "after toolcall" },
        ]},
      ]),
    );

    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toBe("after toolcall");
  });

  it("返回中文内容也工作", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [{ type: "text", text: "已完成用户登录模块的实现" }] },
      ]),
    );

    const result = await execute("build", "实现登录", { cwd: "/tmp" }, "用户系统");
    expect(result).toBe("已完成用户登录模块的实现");
  });
});

// ═══ 边界条件 ═══

describe("execute — 边界条件", () => {
  it("无 assistant 消息 → 返回 '(no output)'", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "user", content: [{ type: "text", text: "hi" }] }]),
    );

    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toBe("(no output)");
  });

  it("messages 为空数组 → 返回 '(no output)'", async () => {
    mockCreateWorkerSession.mockResolvedValue(fakeSession([]));
    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toBe("(no output)");
  });

  it("assistant 消息无 text part（全是非 text）→ 返回 '(no output)'", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [
          { type: "toolCall", name: "x" },
          { type: "toolCall", name: "y" },
        ]},
      ]),
    );

    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toBe("(no output)");
  });

  it("content 不是数组 → 跳过该消息", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: "not an array" },
        { role: "assistant", content: [{ type: "text", text: "actual text" }] },
      ]),
    );

    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toBe("actual text");
  });

  it("part.text 是空字符串仍然返回（不跳过空字符串）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [{ type: "text", text: "" }] },
      ]),
    );

    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    // 源码：if (part.type === "text") return part.text;  不检查 truthy
    expect(result).toBe("");
  });

  it("task 为空字符串仍然工作", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ]),
    );

    const result = await execute("build", "", { cwd: "/tmp" }, "goal");
    expect(result).toBe("done");
  });

  it("goal 为空字符串仍然工作", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([
        { role: "assistant", content: [{ type: "text", text: "done" }] },
      ]),
    );

    const result = await execute("build", "task", { cwd: "/tmp" }, "");
    expect(result).toBe("done");
  });
});

// ═══ 错误处理 ═══

describe("execute — 错误处理", () => {
  it("session.prompt 抛错 → execute 向上传播", async () => {
    mockCreateWorkerSession.mockResolvedValue({
      prompt: vi.fn().mockRejectedValue(new Error("LLM 失败")),
      messages: [],
    });

    await expect(execute("build", "task", { cwd: "/tmp" }, "goal"))
      .rejects.toThrow("LLM 失败");
  });

  it("createWorkerSession 抛错 → execute 向上传播", async () => {
    mockCreateWorkerSession.mockRejectedValue(new Error("session 创建失败"));

    await expect(execute("build", "task", { cwd: "/tmp" }, "goal"))
      .rejects.toThrow("session 创建失败");
  });

  it("createWorkerSession 返回 null → 访问 prompt 时抛错", async () => {
    mockCreateWorkerSession.mockResolvedValue(null);

    await expect(execute("build", "task", { cwd: "/tmp" }, "goal"))
      .rejects.toThrow();
  });
});

// ═══ 入参验证 ═══

describe("execute — 入参透传", () => {
  it("role 透传给 createWorkerSession", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("explore", "调研", { cwd: "/tmp" }, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.role).toBe("explore");
  });

  it("ctx.cwd 优先于 process.cwd()", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("build", "task", { cwd: "/my/cwd" }, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.cwd).toBe("/my/cwd");
  });

  it("ctx 没 cwd → fallback 到 process.cwd()", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("build", "task", {}, "goal");  // 无 ctx.cwd
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.cwd).toBe(process.cwd());
  });

  it("modelStr 来自 pickAvailableModel 的返回值", async () => {
    mockPickAvailableModel.mockReturnValue("custom-provider/custom-model");
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("build", "task", { cwd: "/tmp" }, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.modelStr).toBe("custom-provider/custom-model");
  });

  it("ctx 透传给 createWorkerSession", async () => {
    const ctx = { cwd: "/tmp", model: "x", custom: "field" };
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("build", "task", ctx, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.ctx).toBe(ctx);
  });

  it("调用 pickAvailableModel（透传 ctx）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    const ctx = { cwd: "/tmp", custom: "value" };
    await execute("build", "task", ctx, "goal");
    expect(mockPickAvailableModel).toHaveBeenCalledTimes(1);
    const callArgs = mockPickAvailableModel.mock.calls[0];
    expect(callArgs[0]).toBe(ctx);
    // 默认走 ctx.model 路径：不传 primary/fallback
    expect(callArgs[1]).toBeUndefined();
    expect(callArgs[2]).toBeUndefined();
  });
});

// ═══ prompt 格式验证 ═══

describe("execute — prompt 格式", () => {
  it("完整 prompt 包含 [全局目标: ...] 和 task", async () => {
    capturedSession = null;
    mockCreateWorkerSession.mockImplementation(async () =>
      makeCapturingMock([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("build", "实现登录功能", { cwd: "/tmp" }, "用户系统");
    expect(capturedSession.prompt).toHaveBeenCalledTimes(1);
    const promptArg = capturedSession.prompt.mock.calls[0][0];
    expect(promptArg).toContain("[全局目标: 用户系统]");
    expect(promptArg).toContain("实现登录功能");
    // 顺序：全局目标在前
    const idxGoal = promptArg.indexOf("[全局目标:");
    const idxTask = promptArg.indexOf("实现登录功能");
    expect(idxGoal).toBeLessThan(idxTask);
  });

  it("空 task 也能正常发 prompt", async () => {
    capturedSession = null;
    mockCreateWorkerSession.mockImplementation(async () =>
      makeCapturingMock([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("build", "", { cwd: "/tmp" }, "goal");
    const promptArg = capturedSession.prompt.mock.calls[0][0];
    expect(promptArg).toContain("[全局目标: goal]");
  });

  it("空 goal 时 prompt 仍有 [全局目标: ] 前缀", async () => {
    capturedSession = null;
    mockCreateWorkerSession.mockImplementation(async () =>
      makeCapturingMock([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );

    await execute("build", "task", { cwd: "/tmp" }, "");
    const promptArg = capturedSession.prompt.mock.calls[0][0];
    expect(promptArg).toContain("[全局目标: ]");
  });
});

// ═══ 多角色支持 ═══

describe("execute — 5 个角色都能跑", () => {
  for (const role of ["explore", "design", "build", "check", "close"] as const) {
    it(`role=${role} 正常返回`, async () => {
      mockCreateWorkerSession.mockResolvedValue(
        fakeSession([{ role: "assistant", content: [{ type: "text", text: `${role} 输出` }] }]),
      );
      const result = await execute(role, "task", { cwd: "/tmp" }, "goal");
      expect(result).toBe(`${role} 输出`);
      const callArgs = mockCreateWorkerSession.mock.calls[0][0];
      expect(callArgs.role).toBe(role);
    });
  }
});

// ═══ tools 参数透传（0.4.1 候选） ═══

describe("execute — tools 透传（0.4.1 候选）", () => {
  beforeEach(() => {
    mockCreateWorkerSession.mockReset();
    mockPickAvailableModel.mockReset().mockReturnValue("minimax-cn/MiniMax-M3");
  });

  it("传 tools → createWorkerSession 收到 builtInTools: tools", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );
    const customTools = ["tinyfish_search", "read", "bash"];
    await execute("explore", "搜", { cwd: "/tmp" }, "goal", customTools);
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.builtInTools).toEqual(customTools);
  });

  it("不传 tools → createWorkerSession 收到 builtInTools: undefined（走 ROLE_DEFAULTS）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );
    await execute("build", "干", { cwd: "/tmp" }, "goal");
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.builtInTools).toBeUndefined();
  });

  it("传空数组 → createWorkerSession 收到 builtInTools: []（不是 undefined）", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSession([{ role: "assistant", content: [{ type: "text", text: "ok" }] }]),
    );
    await execute("build", "干", { cwd: "/tmp" }, "goal", []);
    const callArgs = mockCreateWorkerSession.mock.calls[0][0];
    expect(callArgs.builtInTools).toEqual([]);
  });
});

// ═══ maxToolRounds：防 worker 无限工具调用 ═══

describe("execute — maxToolRounds 工具调用上限", () => {
  it("默认上限为 8（7 次不触发，8 次触发）", async () => {
    // 7 次工具调用 → 不超限 → 正常返回
    const sess7 = fakeSessionWithToolCalls(
      [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
      7,
      { assistantFinalText: "ok" },
    );
    mockCreateWorkerSession.mockResolvedValueOnce(sess7);
    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toBe("ok");
    expect(sess7.abort).not.toHaveBeenCalled();
  });

  it("工具调用超过上限 → 调用 session.abort()", async () => {
    const sess = fakeSessionWithToolCalls(
      [{ role: "assistant", content: [{ type: "text", text: "部分" }] }],
      15, // 远超 8
      { assistantFinalText: "被中断前的输出" },
    );
    mockCreateWorkerSession.mockResolvedValue(sess);

    await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(sess.abort).toHaveBeenCalledTimes(1);
  });

  it("中断后输出含「工具调用上限」标记，供 Orchestrator 识别", async () => {
    mockCreateWorkerSession.mockResolvedValue(
      fakeSessionWithToolCalls(
        [{ role: "assistant", content: [{ type: "text", text: "部分" }] }],
        15,
        { assistantFinalText: "" },
      ),
    );
    const result = await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(result).toContain("工具调用上限");
  });

  it("未超限 → abort 不被调用", async () => {
    const sess = fakeSessionWithToolCalls(
      [{ role: "assistant", content: [{ type: "text", text: "ok" }] }],
      3, // 3 次远低于上限
      { assistantFinalText: "ok" },
    );
    mockCreateWorkerSession.mockResolvedValue(sess);

    await execute("build", "task", { cwd: "/tmp" }, "goal");
    expect(sess.abort).not.toHaveBeenCalled();
  });
});
