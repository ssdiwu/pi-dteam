/**
 * P1-分子层单元测试
 */

import { describe, it, expect } from "vitest";
import { SignalBus } from "../../src/P1/signalBus.js";
import { SharedMemory } from "../../src/P1/sharedMemory.js";

describe("P1-分子层", () => {
  describe("SignalBus", () => {
    it("emit 发送信号", () => {
      const bus = new SignalBus();
      const signal = bus.emit("progress", "worker-0", { percent: 50 });

      expect(signal.type).toBe("progress");
      expect(signal.workerId).toBe("worker-0");
      expect(signal.data.percent).toBe(50);
    });

    it("on 监听信号", () => {
      const bus = new SignalBus();
      const received: any[] = [];

      bus.on("progress", (signal) => {
        received.push(signal);
      });

      bus.emit("progress", "worker-0", { percent: 50 });
      bus.emit("progress", "worker-1", { percent: 100 });

      expect(received.length).toBe(2);
      expect(received[0].workerId).toBe("worker-0");
      expect(received[1].workerId).toBe("worker-1");
    });

    it("getHistory 获取信号历史", () => {
      const bus = new SignalBus();

      bus.emit("progress", "worker-0", {});
      bus.emit("blocked", "worker-1", {});
      bus.emit("progress", "worker-0", {});

      const all = bus.getHistory();
      expect(all.length).toBe(3);

      const worker0 = bus.getHistory("worker-0");
      expect(worker0.length).toBe(2);

      const worker1 = bus.getHistory("worker-1");
      expect(worker1.length).toBe(1);
    });
  });

  describe("SharedMemory", () => {
    it("set 和 get", () => {
      const memory = new SharedMemory();

      memory.set("ns1", "key1", "value1", "agent-0");
      expect(memory.get("ns1", "key1")).toBe("value1");
    });

    it("has 检查键是否存在", () => {
      const memory = new SharedMemory();

      memory.set("ns1", "key1", "value1", "agent-0");

      expect(memory.has("ns1", "key1")).toBe(true);
      expect(memory.has("ns1", "key2")).toBe(false);
      expect(memory.has("ns2", "key1")).toBe(false);
    });

    it("delete 删除键", () => {
      const memory = new SharedMemory();

      memory.set("ns1", "key1", "value1", "agent-0");
      expect(memory.has("ns1", "key1")).toBe(true);

      memory.delete("ns1", "key1");
      expect(memory.has("ns1", "key1")).toBe(false);
    });

    it("keys 列出命名空间下的所有键", () => {
      const memory = new SharedMemory();

      memory.set("ns1", "key1", "value1", "agent-0");
      memory.set("ns1", "key2", "value2", "agent-0");
      memory.set("ns2", "key3", "value3", "agent-0");

      const keys = memory.keys("ns1");
      expect(keys).toContain("key1");
      expect(keys).toContain("key2");
      expect(keys.length).toBe(2);
    });

    it("clear 清空命名空间", () => {
      const memory = new SharedMemory();

      memory.set("ns1", "key1", "value1", "agent-0");
      memory.set("ns1", "key2", "value2", "agent-0");

      memory.clear("ns1");

      expect(memory.has("ns1", "key1")).toBe(false);
      expect(memory.has("ns1", "key2")).toBe(false);
    });
  });
});
