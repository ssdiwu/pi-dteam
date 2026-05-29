/**
 * P2-细胞层单元测试
 */

import { describe, it, expect } from "vitest";
import { runSolo } from "../../src/P2/solo.js";
import { runChain } from "../../src/P2/chain.js";
import { runTeam } from "../../src/P2/team.js";
import { SignalBus } from "../../src/P1/signalBus.js";
import { SharedMemory } from "../../src/P1/sharedMemory.js";
import { WorkerConfig } from "../../src/P0/config.js";

describe("P2-细胞层", () => {
  const bus = new SignalBus();
  const memory = new SharedMemory();

  const executor = async (role: string, task: string, style: string) => {
    return `Executed ${role} with style ${style}: ${task}`;
  };

  describe("solo", () => {
    it("执行成功", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "探索项目结构",
        style: "pragmatist",
        options: [{ type: "role", value: "explore" }],
      };

      const result = await runSolo(config, bus, memory, executor);

      expect(result.status).toBe("done");
      expect(result.conclusion).toContain("explore");
      expect(result.conclusion).toContain("探索项目结构");
    });

    it("缺少 role 时抛出错误", async () => {
      const config: WorkerConfig = {
        type: "solo",
        task: "探索项目结构",
        style: "pragmatist",
      };

      await expect(runSolo(config, bus, memory, executor)).rejects.toThrow();
    });
  });

  describe("chain", () => {
    it("执行成功", async () => {
      const config: WorkerConfig = {
        type: "chain",
        task: "实现用户认证",
        style: "pragmatist",
        options: [
          {
            type: "steps",
            value: [
              { type: "solo", task: "探索项目", style: "pragmatist", options: [{ type: "role", value: "explore" }] },
              { type: "solo", task: "设计方案", style: "pragmatist", options: [{ type: "role", value: "design" }] },
            ],
          },
        ],
      };

      const result = await runChain(config, bus, memory, executor);

      expect(result.status).toBe("done");
      expect(result.results.length).toBe(2);
      expect(result.conclusion).toContain("explore");
      expect(result.conclusion).toContain("design");
    });
  });

  describe("team", () => {
    it("执行成功", async () => {
      const config: WorkerConfig = {
        type: "team",
        task: "并行执行任务",
        style: "pragmatist",
        options: [
          {
            type: "workers",
            value: [
              { type: "solo", task: "任务1", style: "pragmatist", options: [{ type: "role", value: "explore" }] },
              { type: "solo", task: "任务2", style: "pragmatist", options: [{ type: "role", value: "design" }] },
            ],
          },
        ],
      };

      const result = await runTeam(config, bus, memory, executor);

      expect(result.status).toBe("done");
      expect(result.results.length).toBe(2);
      expect(result.conclusion).toContain("explore");
      expect(result.conclusion).toContain("design");
    });
  });
});
