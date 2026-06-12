import { describe, expect, it, vi, beforeEach } from "vitest";
import { clearWidget, handlePanelCommand, renderWidget } from "../src/ui/panel.js";
import { uiStore } from "../src/ui/store.js";

const theme = {
  fg: (_kind: string, text: string) => text,
};

function renderLines(width = 80): string[] {
  const setWidget = vi.fn();
  renderWidget({ hasUI: true, ui: { setWidget } });
  return renderCaptured(setWidget, width);
}

function renderExpandedTab(tab: number, width = 100): string[] {
  const setWidget = vi.fn();
  handlePanelCommand(String(tab), { hasUI: true, ui: { setWidget } });
  return renderCaptured(setWidget, width);
}

function renderCaptured(setWidget: ReturnType<typeof vi.fn>, width: number): string[] {
  const factory = setWidget.mock.calls.at(-1)?.[1];
  expect(factory).toBeTypeOf("function");
  return factory({}, theme).render(width);
}

beforeEach(() => {
  uiStore.reset();
  clearWidget({ hasUI: true, ui: { setWidget: vi.fn() } });
});

describe("ui panel compact widget", () => {
  it("折叠态显示 mode、done/total 和运行中 worker 最新输出", () => {
    uiStore.startRun("复杂任务");
    uiStore.setPlan({ mode: "team", reason: "并行" });
    uiStore.addWorker({ id: "plan", parentId: null, title: "📋 team · 并行" });
    uiStore.addWorker({ id: "step-0", parentId: null, title: "⚒️ build: 任务 A" });
    uiStore.addWorker({ id: "step-1", parentId: null, title: "🛡️ check: 任务 B" });
    uiStore.updateWorker("step-0", { status: "running", recentOutput: "running output\nsecond line" });
    uiStore.updateWorker("step-1", { status: "done", recentOutput: "done output" });

    const text = renderLines().join("\n");

    expect(text).toContain("● dteam [team] 1/2 done");
    expect(text).toContain("◐");
    expect(text).toContain("✓");
    expect(text).toContain("⎿ running output");
    expect(text).not.toContain("done output");
    expect(text).toContain("\u0336");
  });

  it("折叠态显示 delayed warning", () => {
    uiStore.startRun("复杂任务");
    uiStore.setScheduling({
      batches: [{ index: 0, stepIndexes: [0], reason: "先跑 0" }, { index: 1, stepIndexes: [1], reason: "后跑 1" }],
      conflicts: [{ type: "hard", stepIndexes: [0, 1], files: ["src/a.ts"], reason: "同文件" }],
      delayedSteps: [{ stepIndex: 1, delayedBecause: ["同文件冲突：src/a.ts"] }],
    });
    uiStore.addWorker({ id: "step-0", parentId: null, title: "⚒️ build: 任务 A" });
    uiStore.addWorker({ id: "step-1", parentId: null, title: "🛡️ check: 任务 B" });
    uiStore.updateWorker("step-0", { status: "running" });
    uiStore.updateWorker("step-1", { status: "idle" });

    const text = renderLines().join("\n");

    expect(text).toContain("↳ delayed: 同文件冲突：src/a.ts");
  });

  it("展开态使用固定内容 tabs", () => {
    uiStore.startRun("复杂任务");
    uiStore.setPlan({ mode: "team", reason: "并行" });

    const text = renderExpandedTab(0).join("\n");

    expect(text).toContain("[0:概览]");
    expect(text).toContain("1:批次");
    expect(text).toContain("2:Workers");
    expect(text).toContain("3:信号");
    expect(text).toContain("4:报告");
    expect(text).not.toContain("W:");
  });

  it("批次 tab 显示 batches、delayedBecause 和 conflicts", () => {
    uiStore.startRun("复杂任务");
    uiStore.setScheduling({
      batches: [{ index: 0, stepIndexes: [0], reason: "先跑 0" }, { index: 1, stepIndexes: [1], reason: "后跑 1" }],
      conflicts: [{ type: "hard", stepIndexes: [0, 1], files: ["src/a.ts"], reason: "同文件" }],
      delayedSteps: [{ stepIndex: 1, delayedBecause: ["同文件冲突：src/a.ts"] }],
    });

    const text = renderExpandedTab(1).join("\n");

    expect(text).toContain("#0 steps [0]");
    expect(text).toContain("step-1: 同文件冲突：src/a.ts");
    expect(text).toContain("hard: steps [0, 1]");
  });

  it("Workers tab 显示 worker 树、files 和最多 2 行输出", () => {
    uiStore.startRun("复杂任务");
    uiStore.addWorker({ id: "step-0", parentId: null, title: "⚒️ build: 任务 A", files: ["src/a.ts"] });
    uiStore.updateWorker("step-0", { status: "running", recentOutput: "out-1" });
    uiStore.updateWorker("step-0", { recentOutput: "out-2" });
    uiStore.updateWorker("step-0", { recentOutput: "out-3" });

    const text = renderExpandedTab(2).join("\n");

    expect(text).toContain("src/a.ts");
    expect(text).not.toContain("out-1");
    expect(text).toContain("out-2");
    expect(text).toContain("out-3");
  });

  it("信号 tab 聚合 found/progress/help/blocked", () => {
    uiStore.startRun("复杂任务");
    uiStore.addWorker({ id: "step-0", parentId: null, title: "build" });
    for (const type of ["found", "progress", "help", "blocked"]) {
      uiStore.addSignal("step-0", { type, workerId: "step-0", summary: `${type} summary`, timestamp: Date.now() });
    }

    const text = renderExpandedTab(3).join("\n");

    expect(text).toContain("发现: 1 条");
    expect(text).toContain("进度: 1 条");
    expect(text).toContain("求助: 1 条");
    expect(text).toContain("阻塞: 1 条");
  });

  it("报告 tab 运行中显示待完成，完成后显示 final summary", () => {
    uiStore.startRun("复杂任务");
    uiStore.addWorker({ id: "step-0", parentId: null, title: "build" });
    expect(renderExpandedTab(4).join("\n")).toContain("报告待完成");

    uiStore.updateWorker("step-0", { status: "done" });
    uiStore.finishRun();

    expect(renderExpandedTab(4).join("\n")).toContain("final: 1/1 完成");
  });

  it("完成后 uiStore 保留快照，下一次 startRun 才清理", () => {
    uiStore.startRun("上一轮");
    uiStore.addWorker({ id: "step-0", parentId: null, title: "build" });
    uiStore.updateWorker("step-0", { status: "done" });
    uiStore.finishRun();

    expect(uiStore.getState().goal).toBe("上一轮");
    expect(uiStore.getState().finishedAt).not.toBeNull();
    expect(renderLines().join("\n")).toContain("1/1 done");

    uiStore.startRun("下一轮");
    expect(uiStore.getState().goal).toBe("下一轮");
    expect(uiStore.getState().workers).toHaveLength(0);
  });
});
