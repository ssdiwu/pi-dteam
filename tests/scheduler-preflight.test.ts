import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFileGraph, preflightSchedule } from "../src/scheduler/index.js";
import type { PlanStep } from "../src/tools.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "dteam-preflight-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function file(relativePath: string, content: string): void {
  const absolute = path.join(cwd, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

describe("preflightSchedule", () => {
  it("无冲突时保持同批并行", () => {
    const steps: PlanStep[] = [
      { role: "build", task: "a", strategy: "direct", files: ["src/a.ts"] },
      { role: "check", task: "b", strategy: "direct", files: ["src/b.ts"] },
    ];
    const graph = buildFileGraph(["src/a.ts", "src/b.ts"], { cwd });

    const plan = preflightSchedule(steps, graph);

    expect(plan.conflicts).toHaveLength(0);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].stepIndexes).toEqual([0, 1]);
    expect(plan.delayedSteps).toHaveLength(0);
  });

  it("hard conflict：两个 step 声明同一文件时自动拆批", () => {
    const steps: PlanStep[] = [
      { role: "build", task: "a", strategy: "direct", files: ["src/a.ts"] },
      { role: "check", task: "b", strategy: "direct", files: ["src/a.ts"] },
    ];
    const graph = buildFileGraph(["src/a.ts"], { cwd });

    const plan = preflightSchedule(steps, graph);

    expect(plan.conflicts.some((c) => c.type === "hard")).toBe(true);
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].stepIndexes).toEqual([0]);
    expect(plan.batches[1].stepIndexes).toEqual([1]);
    expect(plan.delayedSteps.find((delay) => delay.stepIndex === 1)?.delayedBecause).toContain("同文件冲突：src/a.ts");
  });

  it("shared conflict：共享文件相关 step 自动拆批", () => {
    const steps: PlanStep[] = [
      { role: "build", task: "pkg", strategy: "direct", files: ["package.json"] },
      { role: "check", task: "code", strategy: "direct", files: ["src/a.ts"] },
    ];
    file("package.json", `{}`);
    file("src/a.ts", `export const a = 1;`);
    const graph = buildFileGraph(["package.json", "src/a.ts"], { cwd });

    const plan = preflightSchedule(steps, graph);

    expect(plan.conflicts.some((c) => c.type === "shared")).toBe(true);
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].stepIndexes).toEqual([0]);
    expect(plan.batches[1].stepIndexes).toEqual([1]);
    expect(plan.delayedSteps.find((delay) => delay.stepIndex === 1)?.delayedBecause.join("；")).toContain("共享文件冲突");
  });

  it("dependency edge：被依赖文件 step 先，依赖方 step 后", () => {
    file("src/user.ts", `export const user = 1;`);
    file("src/auth.ts", `import { user } from "./user"; export const auth = user;`);
    const steps: PlanStep[] = [
      { role: "build", task: "改 auth", strategy: "direct", files: ["src/auth.ts"] },
      { role: "check", task: "改 user", strategy: "direct", files: ["src/user.ts"] },
    ];
    const graph = buildFileGraph(["src/auth.ts", "src/user.ts"], { cwd });

    const plan = preflightSchedule(steps, graph);

    expect(plan.conflicts.some((c) => c.type === "dependency")).toBe(true);
    expect(plan.batches).toHaveLength(2);
    expect(plan.batches[0].stepIndexes).toEqual([1]);
    expect(plan.batches[1].stepIndexes).toEqual([0]);
    expect(plan.delayedSteps.find((delay) => delay.stepIndex === 0)?.delayedBecause.join("；")).toContain("依赖方向");
  });

  it("unknown boundary：缺失 files 不阻塞", () => {
    const steps: PlanStep[] = [
      { role: "build", task: "a", strategy: "direct", files: ["src/a.ts"] },
      { role: "design", task: "b", strategy: "direct" },
    ];
    const graph = buildFileGraph(["src/a.ts"], { cwd });

    const plan = preflightSchedule(steps, graph);

    expect(plan.conflicts.some((c) => c.type === "unknown")).toBe(true);
    expect(plan.batches).toHaveLength(1);
    expect(plan.batches[0].stepIndexes).toEqual([0, 1]);
  });

  it("同一组 steps 多次输入生成相同 batches", () => {
    file("src/a.ts", `import { b } from "./b";`);
    file("src/b.ts", `export const b = 1;`);
    const steps: PlanStep[] = [
      { role: "build", task: "a", strategy: "direct", files: ["src/a.ts"] },
      { role: "check", task: "b", strategy: "direct", files: ["src/b.ts"] },
    ];
    const graph = buildFileGraph(["src/a.ts", "src/b.ts"], { cwd });

    const plan1 = preflightSchedule(steps, graph);
    const plan2 = preflightSchedule(steps, graph);

    expect(plan1.batches).toEqual(plan2.batches);
    expect(plan1.conflicts).toEqual(plan2.conflicts);
  });
});
