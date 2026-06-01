/**
 * 自适应并发控制器单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  sampleSystem,
  transitionState,
  createAdaptiveConcurrencyController,
  ConcurrencyState,
  SystemSample,
} from "../../src/P0/adaptiveConcurrency.js";

// Mock os 模块
vi.mock("os", () => ({
  cpus: () => [
    {
      times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
    },
    {
      times: { user: 100, nice: 0, sys: 50, idle: 850, irq: 0 },
    },
  ],
  freemem: () => 2 * 1024 * 1024 * 1024, // 2GB
}));

describe("自适应并发控制器", () => {
  describe("sampleSystem", () => {
    it("返回正确的系统样本", () => {
      const sample = sampleSystem();

      expect(sample).toHaveProperty("cpuUsage");
      expect(sample).toHaveProperty("freeMemoryMB");
      expect(sample).toHaveProperty("timestamp");

      expect(sample.cpuUsage).toBeGreaterThanOrEqual(0);
      expect(sample.cpuUsage).toBeLessThanOrEqual(100);
      expect(sample.freeMemoryMB).toBeGreaterThan(0);
      expect(sample.timestamp).toBeGreaterThan(0);
    });
  });

  describe("transitionState", () => {
    const createMockContext = (overrides = {}) => ({
      concurrency: 1,
      stableCount: 0,
      samples: [],
      recentLatencies: [],
      minConcurrency: 1,
      maxConcurrency: 8,
      overloadCpuThreshold: 85,
      overloadMemoryThresholdMB: 500,
      stableThreshold: 3,
      ...overrides,
    });

    it("coldStart 状态转移", () => {
      const sample: SystemSample = {
        cpuUsage: 50,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const result = transitionState("coldStart", sample, createMockContext());

      expect(result.state).toBe("exploring");
      expect(result.concurrencyDelta).toBe(0);
    });

    it("exploring 状态正常递增", () => {
      const sample: SystemSample = {
        cpuUsage: 50,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const result = transitionState("exploring", sample, createMockContext());

      expect(result.state).toBe("exploring");
      expect(result.concurrencyDelta).toBe(1);
    });

    it("exploring 状态过载转移", () => {
      const sample: SystemSample = {
        cpuUsage: 90,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const result = transitionState("exploring", sample, createMockContext());

      expect(result.state).toBe("overload");
      expect(result.concurrencyDelta).toBe(-1);
    });

    it("exploring 稳定转移", () => {
      const sample: SystemSample = {
        cpuUsage: 50,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const ctx = createMockContext({
        stableCount: 3,
        recentLatencies: [100, 100, 100, 100],
      });

      const result = transitionState("exploring", sample, ctx);

      expect(result.state).toBe("steady");
      expect(result.concurrencyDelta).toBe(0);
    });

    it("steady 状态过载转移", () => {
      const sample: SystemSample = {
        cpuUsage: 90,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const result = transitionState("steady", sample, createMockContext());

      expect(result.state).toBe("overload");
      expect(result.concurrencyDelta).toBe(-1);
    });

    it("steady 状态微调 - CPU 高", () => {
      const sample: SystemSample = {
        cpuUsage: 75,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const result = transitionState("steady", sample, createMockContext());

      expect(result.state).toBe("steady");
      expect(result.concurrencyDelta).toBe(-1);
    });

    it("steady 状态微调 - CPU 低", () => {
      const sample: SystemSample = {
        cpuUsage: 20,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const result = transitionState("steady", sample, createMockContext());

      expect(result.state).toBe("steady");
      expect(result.concurrencyDelta).toBe(1);
    });

    it("steady 状态微调 - CPU 正常", () => {
      const sample: SystemSample = {
        cpuUsage: 50,
        freeMemoryMB: 1000,
        timestamp: Date.now(),
      };

      const result = transitionState("steady", sample, createMockContext());

      expect(result.state).toBe("steady");
      expect(result.concurrencyDelta).toBe(0);
    });

    it("overload 状态恢复", () => {
      const sample: SystemSample = {
        cpuUsage: 60,
        freeMemoryMB: 2000,
        timestamp: Date.now(),
      };

      const result = transitionState("overload", sample, createMockContext());

      expect(result.state).toBe("steady");
      expect(result.concurrencyDelta).toBe(0);
    });

    it("overload 状态持续过载", () => {
      const sample: SystemSample = {
        cpuUsage: 90,
        freeMemoryMB: 500,
        timestamp: Date.now(),
      };

      const result = transitionState("overload", sample, createMockContext());

      expect(result.state).toBe("overload");
      expect(result.concurrencyDelta).toBe(-1);
    });
  });

  describe("createAdaptiveConcurrencyController", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("创建控制器", () => {
      const controller = createAdaptiveConcurrencyController();

      expect(controller.getCurrentConcurrency()).toBe(1);
      expect(controller.getState()).toBe("coldStart");
    });

    it("启动和停止", () => {
      const controller = createAdaptiveConcurrencyController();

      controller.start();
      expect(controller.getState()).toBe("exploring");

      controller.stop();
      expect(controller.getState()).toBe("exploring"); // 停止后状态不变
    });

    it("边界保护 - 最小并发数", () => {
      const controller = createAdaptiveConcurrencyController({
        minConcurrency: 2,
        maxConcurrency: 8,
      });

      controller.start();
      controller.stop();

      expect(controller.getCurrentConcurrency()).toBeGreaterThanOrEqual(2);
    });

    it("边界保护 - 最大并发数", () => {
      const controller = createAdaptiveConcurrencyController({
        minConcurrency: 1,
        maxConcurrency: 5,
      });

      controller.start();

      // 模拟多次递增
      for (let i = 0; i < 10; i++) {
        vi.advanceTimersByTime(5000);
      }

      controller.stop();

      expect(controller.getCurrentConcurrency()).toBeLessThanOrEqual(5);
    });

    it("报告任务完成", () => {
      const controller = createAdaptiveConcurrencyController();

      controller.reportTaskComplete(100);
      controller.reportTaskComplete(200);

      const samples = controller.getSamples();
      expect(samples).toHaveLength(0); // samples 是系统样本，不是任务完成报告
    });

    it("强制设置状态", () => {
      const controller = createAdaptiveConcurrencyController();

      controller.forceState("overload");
      expect(controller.getState()).toBe("overload");

      controller.forceState("steady");
      expect(controller.getState()).toBe("steady");
    });

    it("配置参数", () => {
      const controller = createAdaptiveConcurrencyController({
        minConcurrency: 2,
        maxConcurrency: 10,
        sampleIntervalMs: 1000,
        overloadCpuThreshold: 90,
        overloadMemoryThresholdMB: 1000,
        stableThreshold: 5,
      });

      controller.start();
      controller.stop();

      // 验证配置生效（通过行为验证）
      expect(controller.getCurrentConcurrency()).toBeGreaterThanOrEqual(2);
    });
  });
});