/**
 * 增强共享内存单元测试
 */

import { describe, it, expect, beforeEach } from "vitest";
import { createEnhancedSharedMemory, EnhancedSharedMemoryImpl } from "../../src/P1/enhancedSharedMemory.js";

describe("EnhancedSharedMemory", () => {
  let memory: EnhancedSharedMemoryImpl;

  beforeEach(() => {
    memory = createEnhancedSharedMemory() as EnhancedSharedMemoryImpl;
  });

  describe("基础操作", () => {
    it("应该能够设置和获取值", () => {
      memory.set("test", "key1", "value1", "agent-1");
      expect(memory.get("test", "key1")).toBe("value1");
    });

    it("应该能够检查键是否存在", () => {
      memory.set("test", "key1", "value1", "agent-1");
      expect(memory.has("test", "key1")).toBe(true);
      expect(memory.has("test", "key2")).toBe(false);
    });

    it("应该能够删除键", () => {
      memory.set("test", "key1", "value1", "agent-1");
      expect(memory.delete("test", "key1")).toBe(true);
      expect(memory.get("test", "key1")).toBeUndefined();
    });

    it("应该能够清空命名空间", () => {
      memory.set("test", "key1", "value1", "agent-1");
      memory.set("test", "key2", "value2", "agent-1");
      memory.clear("test");
      expect(memory.keys("test")).toEqual([]);
    });

    it("应该能够获取所有键", () => {
      memory.set("test", "key1", "value1", "agent-1");
      memory.set("test", "key2", "value2", "agent-1");
      expect(memory.keys("test")).toEqual(["key1", "key2"]);
    });
  });

  describe("批量操作", () => {
    it("应该能够批量设置值", () => {
      memory.setMany("test", {
        key1: "value1",
        key2: "value2",
        key3: "value3",
      }, "agent-1");

      expect(memory.get("test", "key1")).toBe("value1");
      expect(memory.get("test", "key2")).toBe("value2");
      expect(memory.get("test", "key3")).toBe("value3");
    });

    it("应该能够批量获取值", () => {
      memory.setMany("test", {
        key1: "value1",
        key2: "value2",
        key3: "value3",
      }, "agent-1");

      const result = memory.getMany("test", ["key1", "key3"]);
      expect(result).toEqual({
        key1: "value1",
        key3: "value3",
      });
    });
  });

  describe("查询操作", () => {
    it("应该能够按前缀查询", () => {
      memory.set("test", "user.name", "Alice", "agent-1");
      memory.set("test", "user.email", "alice@example.com", "agent-1");
      memory.set("test", "app.name", "TestApp", "agent-1");

      const result = memory.getByPrefix("test", "user.");
      expect(result).toEqual({
        "user.name": "Alice",
        "user.email": "alice@example.com",
      });
    });

    it("应该能够获取所有命名空间", () => {
      memory.set("ns1", "key1", "value1", "agent-1");
      memory.set("ns2", "key2", "value2", "agent-1");
      memory.set("ns3", "key3", "value3", "agent-1");

      expect(memory.namespaces()).toEqual(["ns1", "ns2", "ns3"]);
    });
  });

  describe("历史追踪", () => {
    it("应该能够追踪修改历史", () => {
      memory.set("test", "key1", "value1", "agent-1");
      memory.set("test", "key1", "value2", "agent-2");
      memory.set("test", "key1", "value3", "agent-3");

      const history = memory.history("test", "key1");
      expect(history).toHaveLength(2); // 只有旧值会被记录到历史
      expect(history[0].value).toBe("value1");
      expect(history[0].agentId).toBe("agent-1");
      expect(history[1].value).toBe("value2");
      expect(history[1].agentId).toBe("agent-2");
    });

    it("应该为每个键维护独立的版本号", () => {
      memory.set("test", "key1", "value1", "agent-1");
      memory.set("test", "key1", "value2", "agent-1");
      memory.set("test", "key2", "value3", "agent-1");

      const snapshot = memory.snapshot();
      expect(snapshot.namespaces["test"]["key1"].version).toBe(2);
      expect(snapshot.namespaces["test"]["key2"].version).toBe(1);
    });
  });

  describe("快照功能", () => {
    it("应该能够创建快照", () => {
      memory.set("test", "key1", "value1", "agent-1");
      memory.set("test", "key2", "value2", "agent-1");

      const snapshot = memory.snapshot();
      expect(snapshot.timestamp).toBeGreaterThan(0);
      expect(snapshot.namespaces["test"]).toBeDefined();
      expect(snapshot.namespaces["test"]["key1"].value).toBe("value1");
      expect(snapshot.namespaces["test"]["key2"].value).toBe("value2");
    });

    it("应该能够从快照恢复", () => {
      memory.set("test", "key1", "value1", "agent-1");
      memory.set("test", "key2", "value2", "agent-1");

      const snapshot = memory.snapshot();

      // 清空内存
      memory.clear("test");
      expect(memory.get("test", "key1")).toBeUndefined();

      // 从快照恢复
      memory.restore(snapshot);
      expect(memory.get("test", "key1")).toBe("value1");
      expect(memory.get("test", "key2")).toBe("value2");
    });
  });

  describe("持久化", () => {
    it("应该能够保存到文件", async () => {
      memory.set("test", "key1", "value1", "agent-1");
      
      const filepath = "/tmp/test-memory-save.json";
      await memory.save(filepath);
      
      // 验证文件存在
      const { existsSync } = await import("node:fs");
      expect(existsSync(filepath)).toBe(true);
    });

    it("应该能够从文件加载", async () => {
      memory.set("test", "key1", "value1", "agent-1");
      memory.set("test", "key2", "value2", "agent-1");
      
      const filepath = "/tmp/test-memory-load.json";
      await memory.save(filepath);

      // 创建新实例并加载
      const newMemory = createEnhancedSharedMemory();
      await newMemory.load(filepath);
      
      expect(newMemory.get("test", "key1")).toBe("value1");
      expect(newMemory.get("test", "key2")).toBe("value2");
    });
  });
});
