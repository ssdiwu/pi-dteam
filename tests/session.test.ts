/**
 * session.test.ts — 测试 src/session.ts 的核心函数
 *
 * 覆盖：
 *  - pickAvailableModel（直接测）
 *  - getRoleTools（直接测）
 *  - loadRolePrompt（通过 createWorkerSession 间接测）
 *
 * 策略：
 *  - 导出函数直接 import 测
 *  - 内部函数 loadRolePrompt 通过 mock @earendil-works/pi-coding-agent，
 *    捕获 createAgentSession 的入参，从 resourceLoader.getSystemPrompt() 拿 prompt
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

// ═══ mock @earendil-works/pi-coding-agent ═══
// session.ts 直接 import 这个 module；要测 createWorkerSession 必须 mock
// 注意：vi.mock 的 factory 会被 hoist 到文件顶部，所以必须用 vi.hoisted 来保留外部引用
const { mockCreateAgentSession } = vi.hoisted(() => ({
  mockCreateAgentSession: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createExtensionRuntime: vi.fn(() => ({})),
  SessionManager: {
    inMemory: vi.fn(() => ({ kind: "fake-session-manager" })),
  },
  SettingsManager: {
    inMemory: vi.fn(() => ({ kind: "fake-settings-manager" })),
  },
}));

// mock @earendil-works/pi-ai（避免真解析 model）
vi.mock("@earendil-works/pi-ai", () => ({
  getModel: vi.fn(() => {
    throw new Error("getModel should not be called when registry.find returns truthy");
  }),
}));

import {
  pickAvailableModel,
  getRoleTools,
  createWorkerSession,
} from "../src/session.js";

// ═══ helpers ═══

/**
 * 拿到 mockCreateAgentSession 收到调用时的 resourceLoader，
 * 然后从它取 systemPrompt。这是验证 loadRolePrompt 的关键。
 */
function getCapturedPrompt(callIdx = 0): string {
  const callArgs = mockCreateAgentSession.mock.calls[callIdx]?.[0];
  if (!callArgs) throw new Error(`createAgentSession not called (callIdx=${callIdx})`);
  return callArgs.resourceLoader.getSystemPrompt();
}

/** 构造满足 createWorkerSession 最低要求的 ctx */
function makeCtx(overrides: any = {}): any {
  return {
    modelRegistry: {
      find: vi.fn((provider: string, id: string) => ({ provider, id })),
      authStorage: { kind: "fake-auth" },
      ...overrides,
    },
    cwd: "/tmp",
    ...overrides,
  };
}

// ═══ pickAvailableModel ═══

describe("pickAvailableModel", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  it("ctx 无 modelRegistry → 返回 primary（不报错）", () => {
    expect(pickAvailableModel({}, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7"))
      .toBe("minimax-cn/MiniMax-M3");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("ctx.modelRegistry 是 undefined → 返回 primary", () => {
    expect(pickAvailableModel({ modelRegistry: undefined }, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7"))
      .toBe("minimax-cn/MiniMax-M3");
  });

  it("primary 命中 → 返回 primary，不打 warning", () => {
    const ctx = makeCtx({
      find: vi.fn(() => ({ provider: "minimax-cn", id: "MiniMax-M3" })),
    });
    const result = pickAvailableModel(ctx, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7");
    expect(result).toBe("minimax-cn/MiniMax-M3");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("primary 失败, fallback 命中 → 返回 fallback，打 warning", () => {
    const ctx = makeCtx({
      find: vi.fn((provider: string, id: string) => {
        if (id === "MiniMax-M3") return null;
        if (id === "MiniMax-M2.7") return { provider, id };
        return null;
      }),
    });
    const result = pickAvailableModel(ctx, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7");
    expect(result).toBe("minimax-cn/MiniMax-M2.7");
    expect(consoleSpy).toHaveBeenCalledTimes(1);
    expect(consoleSpy.mock.calls[0][0]).toContain("MiniMax-M3");
    expect(consoleSpy.mock.calls[0][0]).toContain("MiniMax-M2.7");
  });

  it("primary 和 fallback 都失败 → 返回 primary（让后续抛错）", () => {
    const ctx = makeCtx({ find: vi.fn(() => null) });
    expect(pickAvailableModel(ctx, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7"))
      .toBe("minimax-cn/MiniMax-M3");
  });

  it("primary 无 slash → 跳过该项", () => {
    const ctx = makeCtx({
      find: vi.fn((provider: string, id: string) => {
        if (id === "MiniMax-M2.7") return { provider, id };
        return null;
      }),
    });
    // "no-slash-model" 没有 "/" → skip
    const result = pickAvailableModel(ctx, "no-slash-model", "minimax-cn/MiniMax-M2.7");
    expect(result).toBe("minimax-cn/MiniMax-M2.7");
    // find 只被调一次（fallback）
    expect(ctx.modelRegistry.find).toHaveBeenCalledTimes(1);
  });

  it("两个都无 slash → 返回 primary", () => {
    const ctx = makeCtx({ find: vi.fn() });
    expect(pickAvailableModel(ctx, "no-slash-a", "no-slash-b"))
      .toBe("no-slash-a");
    expect(ctx.modelRegistry.find).not.toHaveBeenCalled();
  });

  it("传入 slashIdx === 0 的 model → 跳过该项", () => {
    const ctx = makeCtx({
      find: vi.fn((provider: string, id: string) => {
        if (id === "MiniMax-M2.7") return { provider, id };
        return null;
      }),
    });
    // "/MiniMax-M3" 中 slashIdx === 0 → skip
    const result = pickAvailableModel(ctx, "/MiniMax-M3", "minimax-cn/MiniMax-M2.7");
    expect(result).toBe("minimax-cn/MiniMax-M2.7");
  });

  it("ctx.modelRegistry 缺 find 方法 → 两个都 fail", () => {
    // 没有 find → registry.find?.() 返回 undefined → falsy → 都跳过
    const ctx = { modelRegistry: {} };
    expect(pickAvailableModel(ctx, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7"))
      .toBe("minimax-cn/MiniMax-M3");
  });

  it("fallback 命中但不是 primary → console.error 用 [dteam] 前缀", () => {
    const ctx = makeCtx({
      find: vi.fn((provider: string, id: string) => {
        if (id === "MiniMax-M2.7") return { provider, id };
        return null;
      }),
    });
    pickAvailableModel(ctx, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7");
    expect(consoleSpy.mock.calls[0][0]).toMatch(/^\[dteam\]/);
  });

  // ═══ 默认走 ctx.model 的新行为 ═══

  it("不传 primary/fallback → 从 ctx.model 转 provider/id 字符串", () => {
    const ctx = { model: { provider: "minimax-cn", id: "MiniMax-M3" } };
    expect(pickAvailableModel(ctx)).toBe("minimax-cn/MiniMax-M3");
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it("不传 primary/fallback, ctx.model 是其他会话的模型 → 同样返回", () => {
    const ctx = { model: { provider: "zai", id: "glm-5.1" } };
    expect(pickAvailableModel(ctx)).toBe("zai/glm-5.1");
  });

  it("不传 primary/fallback, ctx 无 model → 拋清晰错误", () => {
    expect(() => pickAvailableModel({})).toThrow(/no model in ctx/);
  });

  it("不传 primary/fallback, ctx.model 缺 provider/id → 拋清晰错误", () => {
    expect(() => pickAvailableModel({ model: {} })).toThrow(/no model in ctx/);
  });

  it("显式 primary 优先于 ctx.model", () => {
    const ctx = makeCtx({
      model: { provider: "zai", id: "glm-5.1" },
    });
    // primary 在 registry 命中 → 走 primary 路径，不用 ctx.model
    const result = pickAvailableModel(ctx, "minimax-cn/MiniMax-M3", "minimax-cn/MiniMax-M2.7");
    expect(result).toBe("minimax-cn/MiniMax-M3");
  });
});

// ═══ getRoleTools ═══

describe("getRoleTools", () => {
  it("explore 角色 → 含 read/bash/grep/find/ls + tinyfish + dteam", () => {
    expect(getRoleTools("explore")).toEqual([
      "read", "bash", "grep", "find", "ls", "tinyfish_search", "tinyfish_fetch",
      "worker_sendSignal", "reference_architecture",
    ]);
  });

  it("design 角色 → 含 read/bash/write/grep/find/ls + dteam", () => {
    expect(getRoleTools("design")).toEqual([
      "read", "bash", "write", "grep", "find", "ls",
      "worker_sendSignal", "reference_architecture",
    ]);
  });

  it("build 角色 → 多 edit + dteam", () => {
    expect(getRoleTools("build")).toEqual([
      "read", "bash", "edit", "write", "grep", "find", "ls",
      "worker_sendSignal", "reference_architecture",
    ]);
  });

  it("check 角色 → 含 dteam", () => {
    expect(getRoleTools("check")).toEqual([
      "read", "bash", "write", "grep", "find", "ls",
      "worker_sendSignal", "reference_architecture",
    ]);
  });

  it("close 角色 → write + dteam", () => {
    expect(getRoleTools("close")).toEqual([
      "read", "bash", "grep", "find", "ls", "write",
      "worker_sendSignal", "reference_architecture",
    ]);
  });

  it("多次调用返回相同引用（来自 ROLE_DEFAULTS 静态配置）", () => {
    const a = getRoleTools("build");
    const b = getRoleTools("build");
    // 实现是直接返回 ROLE_DEFAULTS[role].tools，所以是同一引用
    expect(a).toBe(b);
    expect(a).toEqual(b);
  });

  it("build 是唯一有 edit 的角色", () => {
    const build = new Set(getRoleTools("build"));
    expect(build.has("edit")).toBe(true);
    expect(new Set(getRoleTools("explore")).has("edit")).toBe(false);
    expect(new Set(getRoleTools("design")).has("edit")).toBe(false);
    expect(new Set(getRoleTools("check")).has("edit")).toBe(false);
    expect(new Set(getRoleTools("close")).has("edit")).toBe(false);
  });

  it("5 个角色都有 read, bash, grep, find, ls", () => {
    for (const role of ["explore", "design", "build", "check", "close"] as const) {
      const tools = new Set(getRoleTools(role));
      expect(tools.has("read")).toBe(true);
      expect(tools.has("bash")).toBe(true);
      expect(tools.has("grep")).toBe(true);
      expect(tools.has("find")).toBe(true);
      expect(tools.has("ls")).toBe(true);
    }
  });

  it("close 的 write 在末尾，其他角色没有", () => {
    const explore = getRoleTools("explore");
    const close = getRoleTools("close");
    expect(explore.includes("write")).toBe(false);
    expect(close.indexOf("write")).toBe(close.length - 1 - 2); // 倒数第 3（倒数 2 是 dteam tools）
  });
});

// ═══ loadRolePrompt（通过 createWorkerSession 间接测） ═══

describe("loadRolePrompt（通过 createWorkerSession）", () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockCreateAgentSession.mockResolvedValue({
      session: { prompt: vi.fn(), messages: [] },
    });
  });

  it("cwd/agents/{role}.md 存在 → 读 cwd 的文件", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dteam-test-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "agents"));
      fs.writeFileSync(
        path.join(tmpDir, "agents", "build.md"),
        "---\nname: build\npackage: dteam\n---\n\n# CWD Build Prompt\n\ndo things",
      );

      await createWorkerSession({
        role: "build",
        cwd: tmpDir,
        modelStr: "minimax-cn/MiniMax-M3",
        ctx: makeCtx(),
      });

      expect(getCapturedPrompt()).toBe("# CWD Build Prompt\n\ndo things");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("cwd/agents/{role}.md 不存在，process.cwd()/agents/{role}.md 存在 → fallback 到 process.cwd()", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dteam-test-no-agents-"));
    try {
      // tmpDir 里没 agents/，但 process.cwd() 是仓库根，有 agents/build.md
      await createWorkerSession({
        role: "build",
        cwd: tmpDir,
        modelStr: "minimax-cn/MiniMax-M3",
        ctx: makeCtx(),
      });

      const prompt = getCapturedPrompt();
      // 来自仓库 agents/build.md 的内容（去掉 frontmatter）
      expect(prompt).toContain("dteam 的 build（实现者）");
      expect(prompt).toContain("# dteam Build — 实现者");
      // frontmatter 字段名（"name:"）应该被剥掉
      expect(prompt).not.toMatch(/^name:\s*build/m);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("两个路径都无 agents/{role}.md → 用硬编码 fallback", async () => {
    const fakeCwd = "/totally/nonexistent/__dteam_test_path__/no_agents";
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(fakeCwd);

    try {
      await createWorkerSession({
        role: "explore",
        cwd: fakeCwd,
        modelStr: "minimax-cn/MiniMax-M3",
        ctx: makeCtx(),
      });

      expect(getCapturedPrompt()).toBe(
        "你是 dteam 的 explore（探索者，搜集内部和外部信息）。请完成分配给你的任务。",
      );
    } finally {
      cwdSpy.mockRestore();
    }
  });

  it("frontmatter 被正确剥离（--- ... --- 块消失）", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dteam-test-fm-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "agents"));
      // 含多行 frontmatter
      fs.writeFileSync(
        path.join(tmpDir, "agents", "design.md"),
        "---\nname: design\npackage: dteam\ndescription: 测试角色\n---\n\n# Real Design Content",
      );

      await createWorkerSession({
        role: "design",
        cwd: tmpDir,
        modelStr: "minimax-cn/MiniMax-M3",
        ctx: makeCtx(),
      });

      const prompt = getCapturedPrompt();
      expect(prompt).toBe("# Real Design Content");
      expect(prompt).not.toContain("---");
      expect(prompt).not.toContain("name: design");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("frontmatter 之后是空内容 → 尝试下一个文件（fallback）", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dteam-test-empty-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "agents"));
      // 只有 frontmatter 没 body → loadRolePrompt 内部 body 是空 → 不返回 → 试下一个
      fs.writeFileSync(
        path.join(tmpDir, "agents", "check.md"),
        "---\nname: check\n---\n   \n  ",
      );

      await createWorkerSession({
        role: "check",
        cwd: tmpDir,
        modelStr: "minimax-cn/MiniMax-M3",
        ctx: makeCtx(),
      });

      // body 是空（或纯空白）→ trim 后是 "" → falsy → 试下一个文件
      // 下一个文件是 process.cwd()/agents/check.md，应该有内容
      const prompt = getCapturedPrompt();
      expect(prompt).toContain("dteam 的 check（验收者");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("显式 systemPrompt 覆盖 role → 不走 loadRolePrompt", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dteam-test-explicit-"));
    try {
      fs.mkdirSync(path.join(tmpDir, "agents"));
      fs.writeFileSync(
        path.join(tmpDir, "agents", "build.md"),
        "FROM FILE - should not be used",
      );

      await createWorkerSession({
        role: "build",
        systemPrompt: "EXPLICIT PROMPT",
        cwd: tmpDir,
        modelStr: "minimax-cn/MiniMax-M3",
        ctx: makeCtx(),
      });

      expect(getCapturedPrompt()).toBe("EXPLICIT PROMPT");
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("无 role 也无 systemPrompt → 默认提示", async () => {
    await createWorkerSession({
      cwd: "/tmp",
      modelStr: "minimax-cn/MiniMax-M3",
      ctx: makeCtx(),
    });

    expect(getCapturedPrompt()).toBe("你是一个助手。请完成任务。");
  });
});

// ═══ createWorkerSession 集成验证（验证 role 工具被传入 createAgentSession） ═══

describe("createWorkerSession 集成", () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockCreateAgentSession.mockResolvedValue({
      session: { prompt: vi.fn(), messages: [] },
    });
  });

  it("role=build → createAgentSession 收到 build 的 tools（含 edit/write）", async () => {
    await createWorkerSession({
      role: "build",
      cwd: "/tmp",
      modelStr: "minimax-cn/MiniMax-M3",
      ctx: makeCtx(),
    });

    const callArgs = mockCreateAgentSession.mock.calls[0][0];
    expect(callArgs.tools).toEqual([
      "read", "bash", "edit", "write", "grep", "find", "ls",
      "worker_sendSignal", "reference_architecture",
    ]);
  });

  it("显式 builtInTools 覆盖 role 默认", async () => {
    await createWorkerSession({
      role: "build",
      builtInTools: ["only-read"],
      cwd: "/tmp",
      modelStr: "minimax-cn/MiniMax-M3",
      ctx: makeCtx(),
    });

    const callArgs = mockCreateAgentSession.mock.calls[0][0];
    expect(callArgs.tools).toEqual(["only-read"]);
  });

  it("customTools 透传给 createAgentSession", async () => {
    const customTools = [{ name: "decide", parameters: {} }];
    await createWorkerSession({
      role: "build",
      customTools,
      cwd: "/tmp",
      modelStr: "minimax-cn/MiniMax-M3",
      ctx: makeCtx(),
    });

    const callArgs = mockCreateAgentSession.mock.calls[0][0];
    // customTools 被 spread（加入 worker_sendSignal），检查原始工具仍在
    expect(callArgs.customTools).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "decide" })]),
    );
  });

  it("无 modelRegistry → 抛错", async () => {
    await expect(
      createWorkerSession({
        role: "build",
        cwd: "/tmp",
        modelStr: "minimax-cn/MiniMax-M3",
        ctx: { cwd: "/tmp" },
      }),
    ).rejects.toThrow("modelRegistry not available");
  });

  it("model 解析失败 → 抛错（来自 getModel 或 registry.getAll 都不命中）", async () => {
    const ctx = makeCtx({
      find: vi.fn(() => null),
      getAll: vi.fn(() => []),
    });
    await expect(
      createWorkerSession({
        role: "build",
        cwd: "/tmp",
        modelStr: "unknown-provider/unknown-model",
        ctx,
      }),
    ).rejects.toThrow(/Cannot resolve model/);
  });
});
