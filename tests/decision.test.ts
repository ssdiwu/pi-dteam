/**
 * decision.test.ts — 测试 src/orchestrator-loop/decision.ts
 *
 * 覆盖 phase 2 新增逻辑：
 *  - buildOrchestratorSystemPrompt 含目标性质约束 + 连续失败换策略规则
 *  - buildOrchestratorUserPrompt：
 *    - interrupted worker 用 ⏹ 标注
 *    - 同角色连续≥2次失败/中断 → 追加换策略警告
 *    - 同角色成功 → 无警告
 */

import { describe, it, expect } from "vitest";
import {
  buildOrchestratorSystemPrompt,
  buildOrchestratorUserPrompt,
} from "../src/orchestrator-loop/decision.js";
import type { SummonStep } from "../src/types/loop.js";

function makeStep(over: Partial<SummonStep>): SummonStep {
  return {
    id: "summon-test",
    role: "explore",
    task: "task",
    status: "done",
    signals: [],
    startedAt: 0,
    ...over,
  };
}

describe("buildOrchestratorSystemPrompt", () => {
  it("含目标性质→角色能力约束（P0-2 防越权写）", () => {
    const prompt = buildOrchestratorSystemPrompt();
    expect(prompt).toContain("目标性质");
    expect(prompt).toMatch(/不.*要求.*改文件.*绝不能召唤 build/);
  });

  it("含连续失败换策略规则（P0-3）", () => {
    const prompt = buildOrchestratorSystemPrompt();
    expect(prompt).toContain("连续失败换策略");
    expect(prompt).toMatch(/连续 2 次/);
  });
});

describe("buildOrchestratorUserPrompt — interrupted 标注", () => {
  it("interrupted worker 在轨迹中用 ⏹ 标注", () => {
    const trail = [makeStep({ role: "explore", interrupted: true, status: "done", result: "部分" })];
    const prompt = buildOrchestratorUserPrompt("goal", [], trail, 0);
    expect(prompt).toContain("⏹");
    expect(prompt).toContain("[被中断]");
  });

  it("正常 done 的 worker 用 ✓ 标注，无 ⏹", () => {
    const trail = [makeStep({ role: "explore", status: "done", result: "完成" })];
    const prompt = buildOrchestratorUserPrompt("goal", [], trail, 0);
    expect(prompt).toContain("✓");
    expect(prompt).not.toContain("⏹");
  });
});

describe("buildOrchestratorUserPrompt — 连续失败警告", () => {
  it("同角色连续 2 次失败 → 追加换策略警告", () => {
    const trail = [
      makeStep({ role: "explore", status: "failed", result: "失败1" }),
      makeStep({ role: "explore", status: "failed", result: "失败2" }),
    ];
    const prompt = buildOrchestratorUserPrompt("goal", [], trail, 0);
    expect(prompt).toContain("已连续 2 次");
    expect(prompt).toContain("必须换策略");
  });

  it("同角色连续 2 次被中断 → 追加换策略警告（中断也算失败）", () => {
    const trail = [
      makeStep({ role: "explore", interrupted: true, status: "done", result: "中断1" }),
      makeStep({ role: "explore", interrupted: true, status: "done", result: "中断2" }),
    ];
    const prompt = buildOrchestratorUserPrompt("goal", [], trail, 0);
    expect(prompt).toContain("已连续 2 次");
  });

  it("同角色末尾成功 → 无警告（成功打断连续计数）", () => {
    const trail = [
      makeStep({ role: "explore", status: "failed", result: "失败" }),
      makeStep({ role: "explore", status: "done", result: "成功" }),
    ];
    const prompt = buildOrchestratorUserPrompt("goal", [], trail, 0);
    expect(prompt).not.toContain("已连续");
  });

  it("不同角色交替失败 → 无警告（只计末尾同类连续）", () => {
    const trail = [
      makeStep({ role: "explore", status: "failed", result: "失败" }),
      makeStep({ role: "build", status: "failed", result: "失败" }),
    ];
    const prompt = buildOrchestratorUserPrompt("goal", [], trail, 0);
    expect(prompt).not.toContain("已连续");
  });

  it("连续 1 次失败 → 无警告（阈值是 2）", () => {
    const trail = [makeStep({ role: "explore", status: "failed", result: "失败" })];
    const prompt = buildOrchestratorUserPrompt("goal", [], trail, 0);
    expect(prompt).not.toContain("已连续");
  });
});
