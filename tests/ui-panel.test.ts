import { describe, expect, it, vi, beforeEach } from "vitest";
import { renderWidget } from "../src/ui/panel.js";
import { uiStore } from "../src/ui/store.js";

const theme = {
  fg: (_kind: string, text: string) => text,
};

function renderLines(width = 80): string[] {
  const setWidget = vi.fn();
  renderWidget({ hasUI: true, ui: { setWidget } });
  const factory = setWidget.mock.calls.at(-1)?.[1];
  expect(factory).toBeTypeOf("function");
  return factory({}, theme).render(width);
}

beforeEach(() => {
  uiStore.reset();
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
