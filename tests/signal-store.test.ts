/**
 * signal-store.ts 单元测试（0.6.0）
 *
 * 覆盖：TTL 衰减、emit/getActive/on、单 goal 生命周期（dispose）、maxSignals 上限。
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SignalStore } from "../src/signals/signal-store.js";
import type { Signal } from "../src/tools.js";

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    type: "progress",
    workerId: "w-test",
    runId: "run-test",
    timestamp: 0,
    data: { action: "read" as const, target: "file.ts", summary: "test" },
    ...overrides,
  };
}

describe("SignalStore (0.6.0)", () => {
  let realNow: () => number;
  let nowMs: number;

  beforeEach(() => {
    realNow = Date.now;
    nowMs = 1_000_000;
    Date.now = () => nowMs;
  });

  afterEach(() => {
    Date.now = realNow;
  });

  /** 推进虚拟时钟 */
  function advance(ms: number): void {
    nowMs += ms;
  }

  describe("emit + getActive 基础", () => {
    it("新信号 strength=1，立即出现在 getActive", () => {
      const store = new SignalStore("goal-1");
      store.emit(makeSignal({ id: "s1" }));
      const active = store.getActive();
      expect(active).toHaveLength(1);
      expect(active[0].id).toBe("s1");
    });

    it("getActive 返回快照，不改原数据", () => {
      const store = new SignalStore("goal-1");
      store.emit(makeSignal());
      const active = store.getActive();
      active.push(makeSignal());
      expect(store.getActive()).toHaveLength(1);
    });

    it("空 store 返回空数组", () => {
      const store = new SignalStore("goal-1");
      expect(store.getActive()).toEqual([]);
      expect(store.getAll()).toEqual([]);
    });
  });

  describe("TTL 衰减", () => {
    it("strength 随时间衰减（halfLife=1000，age=1000 时 strength=0.5）", () => {
      const store = new SignalStore("goal-1", { halfLifeMs: 1000 });
      store.emit(makeSignal({ id: "s1" }));
      advance(1000);
      // strength = 2^(-1) = 0.5
      const s = store.strength((store as any).signals[0].storedAt);
      expect(s).toBeCloseTo(0.5, 5);
    });

    it("age=0 时 strength=1", () => {
      const store = new SignalStore("goal-1", { halfLifeMs: 1000 });
      store.emit(makeSignal({ id: "s1" }));
      const s = store.strength((store as any).signals[0].storedAt);
      expect(s).toBe(1);
    });

    it("低于 expiryThreshold 的信号不进入 getActive", () => {
      const store = new SignalStore("goal-1", { halfLifeMs: 1000, expiryThreshold: 0.1 });
      store.emit(makeSignal({ id: "s1" }));
      // strength = 0.1 需要 age/halfLife ≈ 3.32 → age ≈ 3322
      advance(3322);
      const active = store.getActive();
      expect(active).toHaveLength(0);
    });

    it("新信号优先：getActive 按 strength 降序", () => {
      const store = new SignalStore("goal-1", { halfLifeMs: 1000, expiryThreshold: 0.001 });
      store.emit(makeSignal({ id: "old" }));
      advance(500);
      store.emit(makeSignal({ id: "new" }));
      const active = store.getActive();
      expect(active[0].id).toBe("new"); // strength 高的排前
      expect(active[1].id).toBe("old");
    });

    it("getAll 返回全部（含已衰减），按时间顺序", () => {
      const store = new SignalStore("goal-1", { halfLifeMs: 1, expiryThreshold: 0.9 });
      store.emit(makeSignal({ id: "s1" }));
      advance(10);
      store.emit(makeSignal({ id: "s2" }));
      advance(10);
      // s1 早已衰减出 getActive
      expect(store.getActive()).toHaveLength(0);
      // 但 getAll 保留全部
      expect(store.getAll().map(s => s.id)).toEqual(["s1", "s2"]);
    });
  });

  describe("按 worker / type 过滤", () => {
    it("getActiveByWorker", () => {
      const store = new SignalStore("goal-1");
      store.emit(makeSignal({ id: "s1", workerId: "w-1" }));
      store.emit(makeSignal({ id: "s2", workerId: "w-2" }));
      expect(store.getActiveByWorker("w-1").map(s => s.id)).toEqual(["s1"]);
      expect(store.getActiveByWorker("w-2").map(s => s.id)).toEqual(["s2"]);
    });

    it("getActiveByType", () => {
      const store = new SignalStore("goal-1");
      store.emit(makeSignal({ id: "s1", type: "progress" }));
      store.emit(makeSignal({ id: "s2", type: "found" }));
      expect(store.getActiveByType("found").map(s => s.id)).toEqual(["s2"]);
    });
  });

  describe("on 监听器", () => {
    it("emit 时触发对应类型监听", () => {
      const store = new SignalStore("goal-1");
      const received: Signal[] = [];
      store.on("progress", s => received.push(s));
      store.emit(makeSignal({ type: "progress", id: "s1" }));
      store.emit(makeSignal({ type: "found", id: "s2" }));
      expect(received).toHaveLength(1);
      expect(received[0].id).toBe("s1");
    });

    it("返回取消订阅函数", () => {
      const store = new SignalStore("goal-1");
      const received: Signal[] = [];
      const unsub = store.on("progress", s => received.push(s));
      store.emit(makeSignal({ type: "progress" }));
      unsub();
      store.emit(makeSignal({ type: "progress" }));
      expect(received).toHaveLength(1);
    });

    it("监听器即使信号已衰减也会触发（实时通知）", () => {
      const store = new SignalStore("goal-1", { halfLifeMs: 1, expiryThreshold: 0.9 });
      let count = 0;
      store.on("progress", () => count++);
      advance(10);
      store.emit(makeSignal({ type: "progress" }));
      // 信号可能已不在 getActive，但监听器实时触发了
      expect(count).toBe(1);
    });
  });

  describe("maxSignals 上限", () => {
    it("超过上限丢弃最旧", () => {
      const store = new SignalStore("goal-1", { maxSignals: 3 });
      store.emit(makeSignal({ id: "s1" }));
      store.emit(makeSignal({ id: "s2" }));
      store.emit(makeSignal({ id: "s3" }));
      store.emit(makeSignal({ id: "s4" }));
      const all = store.getAll().map(s => s.id);
      expect(all).toEqual(["s2", "s3", "s4"]); // s1 被丢
      expect(store.size()).toBe(3);
    });
  });

  describe("单 goal 生命周期（dispose）", () => {
    it("getGoalId 返回构造时的 goalId", () => {
      const store = new SignalStore("goal-xyz");
      expect(store.getGoalId()).toBe("goal-xyz");
    });

    it("dispose 后再操作抛错（信号和监听器已不可访问）", () => {
      const store = new SignalStore("goal-1");
      store.emit(makeSignal());
      store.on("progress", () => {});
      expect(store.size()).toBe(1);
      store.dispose();
      // dispose 后任何访问都应抛错，证明信号和监听器已清理且不可再用
      expect(() => store.getAll()).toThrow(/已 dispose/);
      expect(() => store.getActive()).toThrow(/已 dispose/);
      expect(() => store.emit(makeSignal())).toThrow(/已 dispose/);
    });

    it("dispose 后再操作抛错", () => {
      const store = new SignalStore("goal-1");
      store.dispose();
      expect(() => store.emit(makeSignal())).toThrow(/已 dispose/);
      expect(() => store.getActive()).toThrow(/已 dispose/);
    });
  });

  describe("size / activeSize", () => {
    it("size 含已衰减，activeSize 只含活跃", () => {
      const store = new SignalStore("goal-1", { halfLifeMs: 1, expiryThreshold: 0.5 });
      store.emit(makeSignal({ id: "s1" }));
      advance(5); // s1 衰减
      store.emit(makeSignal({ id: "s2" }));
      expect(store.size()).toBe(2);
      expect(store.activeSize()).toBe(1);
    });
  });
});
