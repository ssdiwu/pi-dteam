/**
 * 上下文构建器单元测试
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createContextBuilder, ContextBuilder } from "../../src/P2/contextBuilder.js";
import { createEnhancedSharedMemory } from "../../src/P1/enhancedSharedMemory.js";
import { SignalBus } from "../../src/P1/signalBus.js";
import { WorkerConfig } from "../../src/P0/config.js";

describe("ContextBuilder", () => {
  let contextBuilder: ContextBuilder;
  let memory: ReturnType<typeof createEnhancedSharedMemory>;
  let bus: SignalBus;
  const cwd = process.cwd();

  beforeEach(() => {
    memory = createEnhancedSharedMemory();
    bus = new SignalBus();
    contextBuilder = createContextBuilder(cwd, memory, bus);
  });

  describe("build", () => {
    it("应该构建完整的执行上下文", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "实现用户登录功能",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const context = await contextBuilder.build(config);

      expect(context).toBeDefined();
      expect(context.role).toBe("build");
      expect(context.task).toBe("实现用户登录功能");
      expect(context.style).toBe("explore");
      expect(context.cwd).toBe(cwd);
      expect(context.memory).toBe(memory);
      expect(context.bus).toBe(bus);
    });

    it("应该构建任务上下文", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "实现用户登录功能",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const context = await contextBuilder.build(config);

      expect(context.taskContext).toBeDefined();
      expect(context.taskContext.goal).toBe("实现用户登录功能");
    });

    it("应该构建项目上下文", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "实现用户登录功能",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const context = await contextBuilder.build(config);

      expect(context.projectContext).toBeDefined();
      expect(context.projectContext.root).toBe(cwd);
      expect(context.projectContext.structure).toBeDefined();
      expect(context.projectContext.dependencies).toBeDefined();
    });

    it("应该构建执行历史", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "实现用户登录功能",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const context = await contextBuilder.build(config);

      expect(context.executionHistory).toBeDefined();
      expect(context.executionHistory.previousResults).toEqual([]);
      expect(context.executionHistory.decisions).toEqual([]);
      expect(context.executionHistory.learnings).toEqual([]);
    });

    it("应该将上下文存储到共享内存", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "实现用户登录功能",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      await contextBuilder.build(config);

      // 验证共享内存中存储了数据
      expect(memory.has("task", "details")).toBe(true);
      expect(memory.has("task", "config")).toBe(true);
      expect(memory.has("project", "structure")).toBe(true);
      expect(memory.has("project", "dependencies")).toBe(true);
      expect(memory.has("execution", "history")).toBe(true);
    });

    it("应该能够从共享内存获取历史上下文", async () => {
      // 先存储一些历史数据
      memory.set("execution", "history", {
        previousResults: [
          {
            timestamp: Date.now(),
            role: "explore",
            task: "探索项目",
            result: "成功",
            success: true,
            duration: 1000,
          },
        ],
        decisions: [],
        learnings: ["项目使用 TypeScript"],
      }, "test");

      const config: WorkerConfig = {
        type: "solo",
        task: "实现用户登录功能",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const context = await contextBuilder.build(config);

      expect(context.executionHistory.previousResults).toHaveLength(1);
      expect(context.executionHistory.learnings).toContain("项目使用 TypeScript");
    });
  });

  describe("双层验收解析（v2 task 模板）", () => {
    /** 直接调内部 parseTaskContent（走 as any，避免改主代码） */
    function parse(content: string, filename: string) {
      return (contextBuilder as any).parseTaskContent(content, filename);
    }

    const DUAL_LAYER_MD = `# 双层验收任务

## 基本信息
- ID: 20260601120000-abcd
- 类型: refactor
- 创建时间: 2026-06-01T12:00:00.000Z
- 状态: todo

## 目标
- 为什么: 验证双层解析
- 做什么: 解析 ## 验收条件（分两层） 标题

## 范围
- 包含: src/
- 排除: UI

## 验收条件（分两层）

### A. 可校验（机器可验证）
- [ ] AC-1 typecheck 通过
- [ ] AC-2 测试全过
- [ ] AC-3 pi -e 加载成功

### B. 人工裁决（需用户确认）
- [ ] HR-1 UI 体验足够流畅
- [ ] HR-2 文档完整

## 阶段记录
### 探索发现
（待填写）
`;

    it("应正确解析「## 验收条件（分两层）」标题，不报 section not found", () => {
      const task = parse(DUAL_LAYER_MD, "测试-20260601120000-abcd.md");

      expect(task.id).toBe("20260601120000-abcd");
      expect(task.type).toBe("refactor");
      expect(task.goal).toContain("解析 ## 验收条件（分两层） 标题");
    });

    it("acceptance 默认只包含 A 层可校验项", () => {
      const task = parse(DUAL_LAYER_MD, "测试-20260601120000-abcd.md");

      expect(task.acceptance).toEqual([
        "AC-1 typecheck 通过",
        "AC-2 测试全过",
        "AC-3 pi -e 加载成功",
      ]);
      expect(task.acceptance).toHaveLength(3);
    });

    it("B 层项不会混入 acceptance", () => {
      const task = parse(DUAL_LAYER_MD, "测试-20260601120000-abcd.md");

      for (const item of task.acceptance) {
        expect(item).not.toMatch(/HR-/);
        expect(item).not.toMatch(/体验/);
        expect(item).not.toMatch(/文档完整/);
      }
    });

    it("sections 包含完整「验收条件（分两层）」原文（便于 B 层追溯）", () => {
      const task = parse(DUAL_LAYER_MD, "测试-20260601120000-abcd.md");

      const sectionKey = Object.keys(task.sections).find((k) =>
        k.startsWith("验收条件"),
      );
      expect(sectionKey).toBeDefined();
      expect(task.sections[sectionKey!]).toContain("A. 可校验");
      expect(task.sections[sectionKey!]).toContain("B. 人工裁决");
      expect(task.sections[sectionKey!]).toContain("HR-1");
    });

    it("兼容旧单层「## 验收条件（GWT + 测试）」结构", () => {
      const OLD_MD = `# 旧任务

## 基本信息
- ID: 20260601120000-x001
- 类型: bugfix
- 创建时间: 2026-06-01T12:00:00.000Z
- 状态: todo

## 目标
- 为什么: 兼容
- 做什么: 兼容旧单层

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）
- [ ] AC-1 老格式
- [ ] AC-2 旧任务

## 阶段记录
### 探索发现
（待填写）
`;

      const task = parse(OLD_MD, "旧-20260601120000-x001.md");
      expect(task.acceptance).toEqual(["AC-1 老格式", "AC-2 旧任务"]);
    });
  });
});

describe("createExecutor", () => {
  it("应该创建执行器并记录结果", async () => {
    const { createExecutor } = await import("../../src/P2/contextBuilder.js");
    const memory = createEnhancedSharedMemory();
    const bus = new SignalBus();
    const contextBuilder = createContextBuilder(process.cwd(), memory, bus);

    const config: WorkerConfig = {
      type: "solo",
      task: "测试任务",
      style: "explore",
      options: [{ type: "role", value: "build" }],
    };

    const context = await contextBuilder.build(config);

    // 创建一个简单的执行器
    const executor = createExecutor(context, async (ctx) => {
      return "执行成功";
    });

    // 执行
    const result = await executor(context);

    expect(result).toBe("执行成功");

    // 验证结果已存储到共享内存
    const history = memory.get("execution", "history") as any;
    expect(history.previousResults).toHaveLength(1);
    expect(history.previousResults[0].success).toBe(true);
    expect(history.previousResults[0].result).toBe("执行成功");
  });

  it("应该记录失败的执行结果", async () => {
    const { createExecutor } = await import("../../src/P2/contextBuilder.js");
    const memory = createEnhancedSharedMemory();
    const bus = new SignalBus();
    const contextBuilder = createContextBuilder(process.cwd(), memory, bus);

    const config: WorkerConfig = {
      type: "solo",
      task: "测试任务",
      style: "explore",
      options: [{ type: "role", value: "build" }],
    };

    const context = await contextBuilder.build(config);

    // 创建一个会失败的执行器
    const executor = createExecutor(context, async (ctx) => {
      throw new Error("执行失败");
    });

    // 执行并期望失败
    await expect(executor(context)).rejects.toThrow("执行失败");

    // 验证失败结果已存储到共享内存
    const history = memory.get("execution", "history") as any;
    expect(history.previousResults).toHaveLength(1);
    expect(history.previousResults[0].success).toBe(false);
    expect(history.previousResults[0].result).toBe("执行失败");
  });
});
