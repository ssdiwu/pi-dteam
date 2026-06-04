/**
 * reporter.ts 契约测试
 *
 * 验证 defaultReporter 的每个方法与 uiStore 行为一致。
 * 【重构方案】Phase 1 验证点
 */

import { describe, it, expect, beforeEach } from "vitest";
import { defaultReporter } from "../src/reporter.js";
import { uiStore } from "../src/ui/index.js";

describe("Reporter 契约", () => {
  beforeEach(() => {
    uiStore.reset();
  });

  it("startRun → uiStore 拿到 goal", () => {
    defaultReporter.startRun("test goal");
    expect(uiStore.getState().goal).toBe("test goal");
  });

  it("addWorker → uiStore 拿到 worker 状态", () => {
    defaultReporter.addWorker({ id: "w-1", parentId: null, title: "build: test" });
    const w = uiStore.getState().workers.find((x) => x.id === "w-1");
    expect(w).toBeDefined();
    expect(w!.title).toBe("build: test");
    expect(w!.status).toBe("idle");
  });

  it("updateWorker → uiStore 状态更新", () => {
    defaultReporter.addWorker({ id: "w-1", parentId: null, title: "x" });
    defaultReporter.updateWorker("w-1", { status: "running" });
    defaultReporter.updateWorker("w-1", { status: "done", recentOutput: "完成" });
    const w = uiStore.getState().workers.find((x) => x.id === "w-1")!;
    expect(w.status).toBe("done");
    expect(w.recentOutput).toContain("完成");
  });

  it("addSignal → uiStore 拿到信号", () => {
    defaultReporter.addWorker({ id: "w-1", parentId: null, title: "x" });
    defaultReporter.addSignal("w-1", {
      type: "progress",
      workerId: "w-1",
      summary: "读了文件",
      timestamp: 100,
    });
    const w = uiStore.getState().workers.find((x) => x.id === "w-1")!;
    expect(w.signals).toHaveLength(1);
    expect(w.signals[0].type).toBe("progress");
    expect(w.signals[0].summary).toBe("读了文件");
  });

  it("addStrategy → uiStore 拿到策略", () => {
    defaultReporter.addStrategy({
      action: "test",
      target: "w-1",
      detail: "测试",
      timestamp: 100,
    });
    expect(uiStore.getState().strategies).toHaveLength(1);
  });

  it("finishRun → uiStore 拿到 finishedAt", () => {
    defaultReporter.startRun("test");
    defaultReporter.finishRun();
    expect(uiStore.getState().finishedAt).not.toBeNull();
  });

  it("reset → uiStore 全部清空", () => {
    defaultReporter.startRun("test");
    defaultReporter.addWorker({ id: "w-1", parentId: null, title: "x" });
    defaultReporter.reset();
    const s = uiStore.getState();
    expect(s.goal).toBe("");
    expect(s.workers).toHaveLength(0);
  });
});
