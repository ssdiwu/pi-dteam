/**
 * P3-chainPlanner 单元测试
 *
 * 覆盖：5 种 task 类型的 plan 生成、解析逻辑、边界情况、双层验收
 */

import { describe, it, expect } from "vitest";
import { generatePlan, extractAcceptanceCriteria, type ChainPlan, type ChainStep } from "../../src/P3/chainPlanner.js";

// ── 测试用 task Markdown 模板 ─────────────────────────────────

function makeTaskMd(type: string, goal: string, criteria: string[] = []): string {
  const criteriaBlock = criteria.length > 0
    ? criteria.map((c) => `- [ ] ${c}`).join("\n")
    : "- [ ] ";

  return `# 测试任务

## 基本信息
- ID: 20260601120000-abcd
- 类型: ${type}
- 创建时间: 2026-06-01T12:00:00.000Z
- 状态: todo

## 目标
- 为什么: 测试用途
- 做什么: ${goal}

## 范围
- 包含: 
- 排除: 

## 验收条件（GWT + 测试）
${criteriaBlock}

## 阶段记录
### 探索发现
（待填写）

### 讨论决策
（待填写）

### 执行记录
（待填写）

### 收口记录
（待填写）
`;
}

/** 双层验收结构 task 模板 */
function makeDualLayerTaskMd(criteria: {
  machine: string[];
  human: string[];
}): string {
  const aBlock = criteria.machine.map((c) => `- [ ] ${c}`).join("\n");
  const bBlock = criteria.human.map((c) => `- [ ] ${c}`).join("\n");
  return `# 双层验收任务

## 基本信息
- ID: 20260601120000-abcd
- 类型: refactor
- 创建时间: 2026-06-01T12:00:00.000Z
- 状态: todo

## 目标
- 为什么: 测试用途
- 做什么: 实现 workItem v1 主干

## 范围
- 包含: src/
- 排除: UI

## 验收条件（分两层）

### A. 可校验（机器可验证）
${aBlock}

### B. 人工裁决（需用户确认）
${bBlock}

## 阶段记录
### 探索发现
（待填写）
`;
}

// ── 测试 ──────────────────────────────────────────────────────

describe("chainPlanner", () => {
  describe("generatePlan — 5 种 task 类型", () => {
    it("infra → explore → design → build → check → close（5 步）", () => {
      const content = makeTaskMd("infra", "实现自动编排功能");
      const plan = generatePlan(content, "实施-自动编排-20260601120000-abcd.md");

      expect(plan.taskId).toBe("20260601120000-abcd");
      expect(plan.taskType).toBe("infra");
      expect(plan.steps.map((s) => s.role)).toEqual([
        "explore", "design", "build", "check", "close",
      ]);
    });

    it("refactor → explore → design → build → check → close（5 步）", () => {
      const content = makeTaskMd("refactor", "重构信号模块");
      const plan = generatePlan(content, "重构-20260601120000-abcd.md");

      expect(plan.taskType).toBe("refactor");
      expect(plan.steps.map((s) => s.role)).toEqual([
        "explore", "design", "build", "check", "close",
      ]);
    });

    it("bugfix → explore → build → check → close（4 步，无 design）", () => {
      const content = makeTaskMd("bugfix", "修复信号丢失问题");
      const plan = generatePlan(content, "修复-20260601120000-abcd.md");

      expect(plan.taskType).toBe("bugfix");
      expect(plan.steps.map((s) => s.role)).toEqual([
        "explore", "build", "check", "close",
      ]);
    });

    it("functional → explore → build → check → close（4 步，无 design）", () => {
      const content = makeTaskMd("functional", "新增用户登录功能");
      const plan = generatePlan(content, "功能-20260601120000-abcd.md");

      expect(plan.taskType).toBe("functional");
      expect(plan.steps.map((s) => s.role)).toEqual([
        "explore", "build", "check", "close",
      ]);
    });

    it("ui → explore → design → build → check → close（5 步）", () => {
      const content = makeTaskMd("ui", "优化设置页面布局");
      const plan = generatePlan(content, "UI-20260601120000-abcd.md");

      expect(plan.taskType).toBe("ui");
      expect(plan.steps.map((s) => s.role)).toEqual([
        "explore", "design", "build", "check", "close",
      ]);
    });
  });

  describe("generatePlan — 依赖关系", () => {
    it("第一步无依赖", () => {
      const content = makeTaskMd("infra", "测试任务");
      const plan = generatePlan(content, "test-20260601120000-abcd.md");

      expect(plan.steps[0].dependsOn).toBeUndefined();
    });

    it("后续步骤依赖前一步（串行链）", () => {
      const content = makeTaskMd("infra", "测试任务");
      const plan = generatePlan(content, "test-20260601120000-abcd.md");

      for (let i = 1; i < plan.steps.length; i++) {
        expect(plan.steps[i].dependsOn).toEqual([plan.steps[i - 1].role]);
      }
    });
  });

  describe("generatePlan — step 结构", () => {
    it("每个 step 包含 role, mode, task", () => {
      const content = makeTaskMd("bugfix", "修复 bug");
      const plan = generatePlan(content, "bug-20260601120000-abcd.md");

      for (const step of plan.steps) {
        expect(step.role).toBeTruthy();
        expect(step.mode).toBe("solo");
        expect(step.task).toBeTruthy();
      }
    });

    it("task 描述包含角色标签", () => {
      const content = makeTaskMd("bugfix", "修复崩溃问题");
      const plan = generatePlan(content, "bug-20260601120000-abcd.md");

      for (const step of plan.steps) {
        expect(step.task).toContain(`[${step.role}]`);
      }
    });
  });

  describe("generatePlan — 验收条件提取", () => {
    it("验收条件中的角色相关内容被提取到对应 step", () => {
      const content = makeTaskMd("infra", "自动编排", [
        "AC1 chainPlanner.ts 实现",
        "AC2 build 集成",
        "AC3 check 测试通过",
      ]);
      const plan = generatePlan(content, "test-20260601120000-abcd.md");

      // build step 应包含 "build" 相关的验收条件
      const buildStep = plan.steps.find((s) => s.role === "build");
      expect(buildStep).toBeDefined();
      expect(buildStep!.task).toContain("build");

      // check step 应包含 "check" 相关的验收条件
      const checkStep = plan.steps.find((s) => s.role === "check");
      expect(checkStep).toBeDefined();
      expect(checkStep!.task).toContain("check");
    });
  });

  describe("generatePlan — 边界情况", () => {
    it("未知 task 类型使用 fallback 链（explore → build → check → close）", () => {
      const content = makeTaskMd("unknown", "未知类型任务");
      const plan = generatePlan(content, "未知-20260601120000-abcd.md");

      expect(plan.taskType).toBe("unknown");
      expect(plan.steps.map((s) => s.role)).toEqual([
        "explore", "build", "check", "close",
      ]);
    });

    it("无验收条件时使用默认描述", () => {
      const content = makeTaskMd("bugfix", "修复问题");
      const plan = generatePlan(content, "bug-20260601120000-abcd.md");

      // 所有 step 应有非空 task
      for (const step of plan.steps) {
        expect(step.task.length).toBeGreaterThan(0);
      }
    });

    it("taskId 从文件名正确提取", () => {
      const content = makeTaskMd("infra", "测试");
      const plan = generatePlan(content, "实施-自动编排-task-20260601182644-dcs3.md");

      expect(plan.taskId).toBe("20260601182644-dcs3");
    });

    it("缺少「做什么」描述时抛出错误", () => {
      const content = makeTaskMd("bugfix", "");

      expect(() => generatePlan(content, "修复-20260601120000-abcd.md")).toThrow(
        /缺少「目标→做什么」描述/,
      );
    });
  });

  describe("双层验收结构", () => {
    it("应正确解析「## 验收条件（分两层）」标题", () => {
      const content = makeDualLayerTaskMd({
        machine: ["AC-1 typecheck 通过", "AC-2 测试全过"],
        human: ["HR-1 UI 清晰", "HR-2 文档完整"],
      });
      const plan = generatePlan(content, "实施-20260601120000-abcd.md");

      expect(plan.taskId).toBe("20260601120000-abcd");
      expect(plan.taskType).toBe("refactor");
    });

    it("extractAcceptanceCriteria 只返回 A 层 acText", () => {
      const content = makeDualLayerTaskMd({
        machine: ["AC-1 typecheck 通过", "AC-2 测试全过"],
        human: ["HR-1 UI 清晰", "HR-2 文档完整"],
      });

      const criteria = extractAcceptanceCriteria(content);

      expect(criteria).toEqual([
        "AC-1 typecheck 通过",
        "AC-2 测试全过",
      ]);
    });

    it("A 层项不会因为包含 B 层描述而被混入", () => {
      const content = makeDualLayerTaskMd({
        machine: [
          "AC-1 build 集成",
          "AC-2 check 全过",
        ],
        human: [
          "HR-1 体验足够流畅",
          "HR-2 与现有设计风格一致",
        ],
      });
      const criteria = extractAcceptanceCriteria(content);

      // B 层文本不应进入 criteria
      for (const c of criteria) {
        expect(c).not.toMatch(/HR-/);
        expect(c).not.toMatch(/体验/);
        expect(c).not.toMatch(/设计风格/);
      }
      expect(criteria).toHaveLength(2);
    });

    it("plan 中 step 描述只由 A 层驱动，B 层不会成为 step 任务", () => {
      const content = makeDualLayerTaskMd({
        machine: ["AC-1 build 集成", "AC-2 check 全过"],
        human: ["HR-1 UI 体验"],
      });
      const plan = generatePlan(content, "实施-20260601120000-abcd.md");

      const allTaskText = plan.steps.map((s) => s.task).join("\n");
      expect(allTaskText).not.toMatch(/UI 体验/);
      expect(allTaskText).not.toMatch(/HR-/);
    });

    it("兼容旧单层结构（无 A/B 子 section）→ 整段视作 A 层", () => {
      const content = makeTaskMd("infra", "测试", [
        "AC-1 build 集成",
        "AC-2 check 全过",
      ]);
      const criteria = extractAcceptanceCriteria(content);
      expect(criteria).toEqual(["AC-1 build 集成", "AC-2 check 全过"]);
    });

    it("旧单层结构仍能生成正常 plan（不抛错）", () => {
      const content = makeTaskMd("infra", "实现编排器", [
        "AC-1 build 集成",
        "AC-2 check 全过",
      ]);
      const plan = generatePlan(content, "实施-20260601120000-abcd.md");
      expect(plan.steps.length).toBeGreaterThan(0);
    });

    it("A 层无 AC id 前缀的项会被忽略（require acId）", () => {
      const content = makeDualLayerTaskMd({
        machine: [
          "AC-1 build 集成",
          "普通描述没 AC id", // 没有 AC 前缀
          "AC-2 check 全过",
        ],
        human: [],
      });
      const criteria = extractAcceptanceCriteria(content);
      // "普通描述没 AC id" 没有 AC id，应被忽略
      expect(criteria).toEqual([
        "AC-1 build 集成",
        "AC-2 check 全过",
      ]);
    });
  });
});
