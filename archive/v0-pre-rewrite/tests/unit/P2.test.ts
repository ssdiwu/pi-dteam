/**
 * P2-细胞层单元测试
 */

import { describe, it, expect } from "vitest";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
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

    it("跑通 chain 嵌套 team fixture，并把上一步输出传给 team", async () => {
      const raw = await readFile(join(process.cwd(), "tests/fixtures/chain-nested-team.json"), "utf-8");
      const config = JSON.parse(raw) as WorkerConfig;
      const seenTasks: string[] = [];
      const fixtureExecutor = async (role: string, task: string) => {
        seenTasks.push(`${role}:${task}`);
        return `${role} output for ${task}`;
      };

      const result = await runChain(config, new SignalBus(), new SharedMemory(), fixtureExecutor);

      expect(result.status).toBe("done");
      expect(result.results).toHaveLength(3);
      expect(result.conclusion).toContain("check output");
      const buildTasks = seenTasks.filter((t) => t.startsWith("build:"));
      expect(buildTasks).toHaveLength(2);
      expect(buildTasks.every((task) => task.includes("explore output"))).toBe(true);
    });

    it("team 步骤失败时 chain failFast 返回 failed", async () => {
      const config: WorkerConfig = {
        type: "chain",
        task: "失败传播",
        style: "pragmatist",
        options: [{
          type: "steps",
          value: [
            { type: "solo", task: "探索", style: "pragmatist", options: [{ type: "role", value: "explore" }] },
            {
              type: "team",
              task: "并行失败",
              style: "pragmatist",
              options: [{ type: "workers", value: [
                { type: "solo", task: "失败 worker", style: "pragmatist", options: [{ type: "role", value: "build" }] },
              ] }],
            },
            { type: "solo", task: "不应执行", style: "pragmatist", options: [{ type: "role", value: "check" }] },
          ],
        }],
      };
      const result = await runChain(config, new SignalBus(), new SharedMemory(), async (role) => {
        if (role === "build") throw new Error("build failed");
        return `${role} ok`;
      });

      expect(result.status).toBe("failed");
      expect(result.results).toHaveLength(2);
      expect(result.error).toContain("build failed");
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

    it("尊重 concurrency 和 timeoutMs 参数", async () => {
      const config: WorkerConfig = {
        type: "team",
        task: "并发超时",
        style: "pragmatist",
        options: [
          { type: "workers", value: [
            { type: "solo", task: "慢任务1", style: "pragmatist", options: [{ type: "role", value: "build" }] },
            { type: "solo", task: "慢任务2", style: "pragmatist", options: [{ type: "role", value: "build" }] },
          ] },
          { type: "concurrency", value: 1 },
          { type: "timeoutMs", value: 5 },
        ],
      };
      let active = 0;
      let maxActive = 0;
      const result = await runTeam(config, new SignalBus(), new SharedMemory(), async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setTimeout(resolve, 20));
        active--;
        return "slow done";
      });

      expect(result.status).toBe("failed");
      expect(result.error).toContain("timed out");
      expect(maxActive).toBe(1);
    });
  });
});
