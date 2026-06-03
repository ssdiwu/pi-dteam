/**
 * P4-dteamTool 单元测试
 *
 * 覆盖 list / plan / run / status 4 个 action。
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  listAgents,
  buildPlan,
  planToWorkerConfig,
  handleDteamAction,
  type AgentMeta,
  type ExecutionPlan,
  type DteamParams,
} from "../../src/P4/dteamTool.js";

describe("dteamTool", () => {
  // ── list ────────────────────────────────────────────────────

  describe("listAgents", () => {
    it("返回角色列表，包含 name/description/tools", async () => {
      const agents = await listAgents();

      expect(agents.length).toBeGreaterThanOrEqual(6);

      // 验证 explore 角色存在
      const explore = agents.find((a) => a.name === "explore");
      expect(explore).toBeDefined();
      expect(explore!.description).toContain("探索");
      expect(explore!.tools.length).toBeGreaterThan(0);

      // 验证 build 角色存在
      const build = agents.find((a) => a.name === "build");
      expect(build).toBeDefined();
      expect(build!.description).toContain("实现");
    });

    it("每个角色都有 name 和 description", async () => {
      const agents = await listAgents();
      for (const agent of agents) {
        expect(agent.name).toBeTruthy();
        expect(agent.description).toBeTruthy();
      }
    });
  });

  // ── plan ────────────────────────────────────────────────────

  describe("buildPlan", () => {
    it("单 agent → mode=solo", () => {
      const plan = buildPlan({
        goal: "探索项目结构",
        agents: ["explore"],
      });

      expect(plan.mode).toBe("solo");
      expect(plan.agents).toEqual(["explore"]);
      expect(plan.steps.length).toBe(1);
      expect(plan.steps[0].agent).toBe("explore");
    });

    it("多 agent → mode=chain（默认）", () => {
      const plan = buildPlan({
        goal: "实现新功能",
        agents: ["explore", "design", "build"],
      });

      expect(plan.mode).toBe("chain");
      expect(plan.agents).toEqual(["explore", "design", "build"]);
      expect(plan.steps.length).toBe(3);

      // 第一步无依赖
      expect(plan.steps[0].dependsOn).toBeUndefined();

      // 第二步依赖第一步
      expect(plan.steps[1].dependsOn).toEqual(["explore"]);

      // 第三步依赖第二步
      expect(plan.steps[2].dependsOn).toEqual(["design"]);
    });

    it("多 agent + mode=team → mode=team", () => {
      const plan = buildPlan({
        goal: "并行检查",
        agents: ["build", "check"],
        mode: "team",
      });

      expect(plan.mode).toBe("team");
      expect(plan.agents).toEqual(["build", "check"]);
    });

    it("无 agents → 使用默认全链", () => {
      const plan = buildPlan({ goal: "完成整个流程" });

      expect(plan.agents).toEqual(["explore", "design", "build", "check", "close"]);
      expect(plan.mode).toBe("chain");
    });

    it("过滤非法角色后为空 → fallback 到 build", () => {
      const plan = buildPlan({
        goal: "测试",
        agents: ["invalid-role"],
      });

      expect(plan.agents).toEqual(["build"]);
    });
  });

  // ── planToWorkerConfig ──────────────────────────────────────

  describe("planToWorkerConfig", () => {
    it("solo 模式生成正确的 WorkerConfig", () => {
      const plan: ExecutionPlan = {
        mode: "solo",
        agents: ["explore"],
        steps: [{ agent: "explore", task: "[explore] 探索" }],
      };

      const config = planToWorkerConfig(plan, "探索", "pragmatist");

      expect(config.type).toBe("solo");
      expect(config.task).toBe("探索");
      expect(config.style).toBe("pragmatist");
      expect(config.options).toEqual([{ type: "role", value: "explore" }]);
    });

    it("chain 模式生成正确的 WorkerConfig", () => {
      const plan: ExecutionPlan = {
        mode: "chain",
        agents: ["explore", "build"],
        steps: [
          { agent: "explore", task: "[explore] 探索" },
          { agent: "build", task: "[build] 实现", dependsOn: ["explore"] },
        ],
      };

      const config = planToWorkerConfig(plan, "实现功能", "pragmatist");

      expect(config.type).toBe("chain");
      expect(config.options).toBeDefined();
      const stepsOpt = config.options!.find((o) => o.type === "steps");
      expect(stepsOpt).toBeDefined();
      expect((stepsOpt!.value as any[]).length).toBe(2);
    });

    it("team 模式生成正确的 WorkerConfig", () => {
      const plan: ExecutionPlan = {
        mode: "team",
        agents: ["build", "check"],
        steps: [
          { agent: "build", task: "[build] 实现" },
          { agent: "check", task: "[check] 检查" },
        ],
      };

      const config = planToWorkerConfig(plan, "并行执行", "pragmatist");

      expect(config.type).toBe("team");
      const workersOpt = config.options!.find((o) => o.type === "workers");
      expect(workersOpt).toBeDefined();
      expect((workersOpt!.value as any[]).length).toBe(2);
    });
  });

  // ── handleDteamAction ───────────────────────────────────────

  describe("handleDteamAction", () => {
    const ctx = { cwd: "/tmp/test" };

    it("action=list 返回角色列表", async () => {
      const result = await handleDteamAction(ctx, { action: "list" });
      const data = JSON.parse(result.content);

      expect(data.agents).toBeDefined();
      expect(data.count).toBeGreaterThanOrEqual(6);
      expect(data.message).toContain("角色");
    });

    it("action=plan 无 goal 返回错误", async () => {
      const result = await handleDteamAction(ctx, { action: "plan" });
      const data = JSON.parse(result.content);

      expect(data.error).toContain("goal");
    });

    it("action=plan 有 goal 返回执行计划", async () => {
      const result = await handleDteamAction(ctx, {
        action: "plan",
        goal: "实现新功能",
        agents: ["explore", "build"],
      });
      const data = JSON.parse(result.content);

      expect(data.plan).toBeDefined();
      expect(data.plan.mode).toBe("chain");
      expect(data.plan.agents).toEqual(["explore", "build"]);
    });

    it("action=run 无 goal 返回错误", async () => {
      const result = await handleDteamAction(ctx, { action: "run" });
      const data = JSON.parse(result.content);

      expect(data.error).toContain("goal");
    });

    it("action=status 无 workerId 返回错误", async () => {
      const result = await handleDteamAction(ctx, { action: "status" });
      const data = JSON.parse(result.content);

      expect(data.error).toContain("workerId");
    });

    it("未知 action 返回错误", async () => {
      const result = await handleDteamAction(ctx, { action: "unknown" as any });
      const data = JSON.parse(result.content);

      expect(data.error).toContain("未知");
    });
  });
});
