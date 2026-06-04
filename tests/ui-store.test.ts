/**
 * ui/store.ts 新功能测试
 *
 * 覆盖：addSignal / addStrategy / signals 分组
 */

import { describe, it, expect } from "vitest";
import { uiStore } from "../src/ui/store.js";

describe("UIStore 信号功能", () => {
  // 每次 test 前 reset
  function resetStore() {
    uiStore.startRun("test goal");
  }

  describe("addSignal", () => {
    it("信号记录到对应 worker", () => {
      resetStore();
      uiStore.addWorker({ id: "w-1", parentId: null, title: "build" });
      uiStore.addSignal("w-1", { type: "progress", workerId: "w-1", summary: "修改了 a.ts", timestamp: Date.now() });
      uiStore.addSignal("w-1", { type: "progress", workerId: "w-1", summary: "修改了 b.ts", timestamp: Date.now() });

      const state = uiStore.getState();
      const w = state.workers.find(w => w.id === "w-1");
      expect(w!.signals).toHaveLength(2);
      expect(w!.signals[0].type).toBe("progress");
    });

    it("不同 worker 的信号互不干扰", () => {
      resetStore();
      uiStore.addWorker({ id: "w-1", parentId: null, title: "build" });
      uiStore.addWorker({ id: "w-2", parentId: null, title: "explore" });
      uiStore.addSignal("w-1", { type: "progress", workerId: "w-1", summary: "写代码", timestamp: Date.now() });
      uiStore.addSignal("w-2", { type: "found", workerId: "w-2", summary: "发现依赖", timestamp: Date.now() });

      const state = uiStore.getState();
      expect(state.workers.find(w => w.id === "w-1")!.signals).toHaveLength(1);
      expect(state.workers.find(w => w.id === "w-2")!.signals).toHaveLength(1);
    });

    it("不存在的 worker 静默忽略", () => {
      resetStore();
      expect(() => uiStore.addSignal("w-none", { type: "help", workerId: "w-none", summary: "test", timestamp: Date.now() })).not.toThrow();
    });

    it("超过 100 条自动裁剪", () => {
      resetStore();
      uiStore.addWorker({ id: "w-1", parentId: null, title: "build" });
      for (let i = 0; i < 110; i++) {
        uiStore.addSignal("w-1", { type: "progress", workerId: "w-1", summary: `sig-${i}`, timestamp: Date.now() });
      }
      const state = uiStore.getState();
      const w = state.workers.find(w => w.id === "w-1");
      expect(w!.signals).toHaveLength(100);
      expect(w!.signals[0].summary).toBe("sig-10");
    });
  });

  describe("addStrategy", () => {
    it("策略记录到 state", () => {
      resetStore();
      uiStore.addStrategy({
        action: "help自愈",
        target: "explore → run-1",
        detail: "为 w-1 补充: 缺少配置信息",
        timestamp: Date.now(),
      });

      const state = uiStore.getState();
      expect(state.strategies).toHaveLength(1);
      expect(state.strategies[0].action).toBe("help自愈");
    });

    it("超过 50 条自动裁剪", () => {
      resetStore();
      for (let i = 0; i < 60; i++) {
        uiStore.addStrategy({ action: `策略-${i}`, target: "", detail: "", timestamp: Date.now() });
      }
      const state = uiStore.getState();
      expect(state.strategies).toHaveLength(50);
    });
  });

  describe("信号在 getState 快照中不影响原数据", () => {
    it("修改快照不影响 store", () => {
      resetStore();
      uiStore.addWorker({ id: "w-1", parentId: null, title: "build" });
      uiStore.addSignal("w-1", { type: "progress", workerId: "w-1", summary: "test", timestamp: Date.now() });

      const snap = uiStore.getState();
      snap.workers[0].signals.push({ type: "help", workerId: "w-1", summary: "fake", timestamp: Date.now() });

      const snap2 = uiStore.getState();
      expect(snap2.workers[0].signals).toHaveLength(1);
    });
  });
});
