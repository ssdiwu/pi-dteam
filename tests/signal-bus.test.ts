/**
 * signal-bus.ts 单元测试
 */

import { describe, it, expect } from "vitest";
import { SignalBus } from "../src/signals/index.js";
import type { Signal } from "../src/tools.js";

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    type: "progress",
    workerId: "w-test",
    runId: "run-test",
    timestamp: Date.now(),
    data: { action: "read" as const, target: "file.ts", summary: "test" },
    ...overrides,
  };
}

describe("SignalBus", () => {
  describe("emit", () => {
    it("追加信号并返回", () => {
      const bus = new SignalBus();
      const signal = makeSignal();
      const result = bus.emit(signal);
      expect(result).toBe(signal);
      expect(bus.getHistory("w-test")).toHaveLength(1);
    });

    it("按 worker 分组存储", () => {
      const bus = new SignalBus();
      bus.emit(makeSignal({ workerId: "w-1" }));
      bus.emit(makeSignal({ workerId: "w-1" }));
      bus.emit(makeSignal({ workerId: "w-2" }));
      expect(bus.getHistory("w-1")).toHaveLength(2);
      expect(bus.getHistory("w-2")).toHaveLength(1);
    });

    it("多个信号保持顺序", () => {
      const bus = new SignalBus();
      bus.emit(makeSignal({ id: "s-1" }));
      bus.emit(makeSignal({ id: "s-2" }));
      bus.emit(makeSignal({ id: "s-3" }));
      const hist = bus.getHistory("w-test");
      expect(hist.map(s => s.id)).toEqual(["s-1", "s-2", "s-3"]);
    });
  });

  describe("getHistory", () => {
    it("不传 workerId 返回全部", () => {
      const bus = new SignalBus();
      bus.emit(makeSignal({ workerId: "w-1" }));
      bus.emit(makeSignal({ workerId: "w-2" }));
      expect(bus.getHistory()).toHaveLength(2);
    });

    it("返回快照（不影响原数据）", () => {
      const bus = new SignalBus();
      bus.emit(makeSignal());
      const hist = bus.getHistory();
      hist.push(makeSignal());
      expect(bus.getHistory()).toHaveLength(1);
    });

    it("不存在的 worker 返回空数组", () => {
      const bus = new SignalBus();
      expect(bus.getHistory("w-none")).toEqual([]);
    });

    it("空 bus 返回空数组", () => {
      const bus = new SignalBus();
      expect(bus.getHistory()).toEqual([]);
    });
  });

  describe("getByRun", () => {
    it("按 runId 过滤", () => {
      const bus = new SignalBus();
      bus.emit(makeSignal({ runId: "run-1" }));
      bus.emit(makeSignal({ runId: "run-1" }));
      bus.emit(makeSignal({ runId: "run-2" }));
      expect(bus.getByRun("run-1")).toHaveLength(2);
      expect(bus.getByRun("run-2")).toHaveLength(1);
    });

    it("不存在的 run 返回空数组", () => {
      const bus = new SignalBus();
      expect(bus.getByRun("run-none")).toEqual([]);
    });

    it("跨 worker 按 run 汇总", () => {
      const bus = new SignalBus();
      bus.emit(makeSignal({ runId: "run-1", workerId: "w-1" }));
      bus.emit(makeSignal({ runId: "run-1", workerId: "w-2" }));
      bus.emit(makeSignal({ runId: "run-2", workerId: "w-1" }));
      expect(bus.getByRun("run-1")).toHaveLength(2);
    });
  });

  describe("on", () => {
    it("监听指定类型", () => {
      const bus = new SignalBus();
      const received: Signal[] = [];
      bus.on("progress", s => received.push(s));
      bus.emit(makeSignal({ type: "progress" }));
      bus.emit(makeSignal({ type: "found" }));
      expect(received).toHaveLength(1);
      expect(received[0].type).toBe("progress");
    });

    it("返回取消监听函数", () => {
      const bus = new SignalBus();
      const received: Signal[] = [];
      const unsub = bus.on("progress", s => received.push(s));
      bus.emit(makeSignal({ type: "progress" }));
      unsub();
      bus.emit(makeSignal({ type: "progress" }));
      expect(received).toHaveLength(1);
    });

    it("同一类型多个 listener 都触发", () => {
      const bus = new SignalBus();
      let count1 = 0, count2 = 0;
      bus.on("blocked", () => count1++);
      bus.on("blocked", () => count2++);
      bus.emit(makeSignal({ type: "blocked" }));
      expect(count1).toBe(1);
      expect(count2).toBe(1);
    });

    it("取消后再注册仍有效", () => {
      const bus = new SignalBus();
      let count = 0;
      const unsub = bus.on("help", () => count++);
      unsub();
      bus.on("help", () => count++);
      bus.emit(makeSignal({ type: "help" }));
      expect(count).toBe(1);
    });
  });
});
