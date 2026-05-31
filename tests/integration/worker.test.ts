/**
 * Worker 工具集成测试
 */

import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { existsSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { 
  workerCreate, 
  workerStart, 
  workerSendSignal,
  workerSaveMemory,
  workerLoadMemory,
  workerGetMemory,
  registerExecutor
} from "../../src/tools/worker.js";
import { WorkerConfig } from "../../src/P0/config.js";
import { ExecutionContext } from "../../src/P2/contextBuilder.js";

describe("Worker 工具集成测试", () => {
  const ctx = { cwd: process.cwd() };

  describe("workerCreate", () => {
    it("应该创建 worker 实例", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "测试任务",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const result = await workerCreate(ctx, { config });
      const parsed = JSON.parse(result.content);

      expect(parsed.workerId).toBeDefined();
      expect(parsed.config).toEqual(config);
      expect(parsed.message).toContain("Worker created");
    });
  });

  describe("workerStart", () => {
    it("应该启动 worker 并返回结果", async () => {
      // 创建 worker
      const config: WorkerConfig = {
        type: "solo",
        task: "实现用户登录功能",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const createResult = await workerCreate(ctx, { config });
      const { workerId } = JSON.parse(createResult.content);

      // 启动 worker
      const startResult = await workerStart(ctx, { workerId });
      const parsed = JSON.parse(startResult.content);

      expect(parsed.workerId).toBe(workerId);
      expect(parsed.result).toBeDefined();
      expect(parsed.context).toBeDefined();
      expect(parsed.context.task).toBeDefined();
      expect(parsed.context.project).toBeDefined();
      expect(parsed.message).toContain("Worker completed");
    });

    it("应该支持自定义执行器", async () => {
      // 注册自定义执行器
      registerExecutor("test-executor", async (context: ExecutionContext) => {
        return `[${context.role}] 自定义执行器: ${context.task}`;
      });

      // 创建 worker
      const config: WorkerConfig = {
        type: "solo",
        task: "测试自定义执行器",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const createResult = await workerCreate(ctx, { config });
      const { workerId } = JSON.parse(createResult.content);

      // 使用自定义执行器启动
      const startResult = await workerStart(ctx, { 
        workerId,
        executorName: "test-executor" 
      });
      const parsed = JSON.parse(startResult.content);

      expect(parsed.result).toBeDefined();
      expect(parsed.result.conclusion).toContain("自定义执行器");
      expect(parsed.result.conclusion).toContain("测试自定义执行器");
    });
  });

  describe("workerSendSignal", () => {
    it("应该发送信号到 worker", async () => {
      // 创建 worker
      const config: WorkerConfig = {
        type: "solo",
        task: "测试信号",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const createResult = await workerCreate(ctx, { config });
      const { workerId } = JSON.parse(createResult.content);

      // 发送信号
      const signalResult = await workerSendSignal(ctx, {
        workerId,
        signalType: "progress",
        data: { status: "testing" },
      });
      const parsed = JSON.parse(signalResult.content);

      expect(parsed.workerId).toBe(workerId);
      expect(parsed.signal).toBeDefined();
      expect(parsed.message).toContain("Signal sent");
    });
  });

  describe("共享内存工具", () => {
    const memoryTestFile = "test-worker-memory.json";
    const memoryTestPath = resolve(process.cwd(), ".dteam/memory", memoryTestFile);

    afterAll(() => {
      if (existsSync(memoryTestPath)) {
        unlinkSync(memoryTestPath);
      }
    });

    it("应该能够保存和加载共享内存", async () => {
      const filepath = memoryTestFile;

      // 保存内存
      const saveResult = await workerSaveMemory(ctx, { filepath });
      const saveParsed = JSON.parse(saveResult.content);
      expect(saveParsed.message).toContain("Memory saved");

      // 加载内存
      const loadResult = await workerLoadMemory(ctx, { filepath });
      const loadParsed = JSON.parse(loadResult.content);
      expect(loadParsed.message).toContain("Memory loaded");
      expect(loadParsed.namespaces).toBeDefined();
    });

    it("应该能够获取共享内存内容", async () => {
      // 先执行一个 worker 来填充内存
      const config: WorkerConfig = {
        type: "solo",
        task: "填充内存测试",
        style: "explore",
        options: [{ type: "role", value: "build" }],
      };

      const createResult = await workerCreate(ctx, { config });
      const { workerId } = JSON.parse(createResult.content);
      await workerStart(ctx, { workerId });

      // 获取所有命名空间
      const allResult = await workerGetMemory(ctx, {});
      const allParsed = JSON.parse(allResult.content);
      expect(allParsed.namespaces).toContain("task");
      expect(allParsed.namespaces).toContain("project");
      expect(allParsed.namespaces).toContain("execution");

      // 获取特定命名空间
      const taskResult = await workerGetMemory(ctx, { namespace: "task" });
      const taskParsed = JSON.parse(taskResult.content);
      expect(taskParsed.keys).toContain("details");
      expect(taskParsed.keys).toContain("config");

      // 获取特定键
      const detailsResult = await workerGetMemory(ctx, { 
        namespace: "task", 
        key: "details" 
      });
      const detailsParsed = JSON.parse(detailsResult.content);
      expect(detailsParsed.value).toBeDefined();
      expect(detailsParsed.value.goal).toBe("填充内存测试");
    });
  });

  describe("多 worker 协作", () => {
    it("应该支持多个 worker 共享内存", async () => {
      // 创建探索 worker
      const exploreConfig: WorkerConfig = {
        type: "solo",
        task: "探索项目结构",
        style: "explore",
        options: [{ type: "role", value: "explore" }],
      };

      const exploreCreate = await workerCreate(ctx, { config: exploreConfig });
      const { workerId: exploreId } = JSON.parse(exploreCreate.content);
      await workerStart(ctx, { workerId: exploreId });

      // 创建设计 worker
      const designConfig: WorkerConfig = {
        type: "solo",
        task: "设计系统架构",
        style: "design",
        options: [{ type: "role", value: "design" }],
      };

      const designCreate = await workerCreate(ctx, { config: designConfig });
      const { workerId: designId } = JSON.parse(designCreate.content);
      await workerStart(ctx, { workerId: designId });

      // 验证共享内存中有多个命名空间
      const memoryResult = await workerGetMemory(ctx, {});
      const memoryParsed = JSON.parse(memoryResult.content);
      
      expect(memoryParsed.namespaces).toContain("task");
      expect(memoryParsed.namespaces).toContain("project");
      expect(memoryParsed.namespaces).toContain("execution");
    });
  });
});
