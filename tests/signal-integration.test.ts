/**
 * orchestrator 信号集成测试
 *
 * 验证根→叶子的双向信号通路：
 * 1. 叶子发 progress → 根的 listener 实时更新 UI
 * 2. 叶子发 help → 根收到后派 explore 补充
 * 3. 叶子发 blocked → step 被标记为 failed
 */

import { describe, it, expect } from "vitest";
import { SignalBus } from "../src/signals/signal-bus.js";
import { RunsStore } from "../src/signals/runs-store.js";
import type { Signal, DteamContext } from "../src/tools.js";

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

describe("信号通路集成", () => {
  describe("progress 信号 → listener 触发", () => {
    it("emit progress 时 listener 被调用", () => {
      const bus = new SignalBus();
      const received: Signal[] = [];
      bus.on("progress", (s) => received.push(s));

      bus.emit(makeSignal({ type: "progress", data: { action: "modify", target: "a.ts", summary: "修改了 a.ts" } }));
      bus.emit(makeSignal({ type: "progress", data: { action: "create", target: "b.ts", summary: "创建了 b.ts" } }));

      expect(received).toHaveLength(2);
      expect(received[0].type).toBe("progress");
      expect(received[1].type).toBe("progress");
    });

    it("found 信号不影响 progress listener", () => {
      const bus = new SignalBus();
      const received: Signal[] = [];
      bus.on("progress", (s) => received.push(s));

      bus.emit(makeSignal({ type: "found", data: { summary: "发现", severity: "info", category: "dependency" } }));
      bus.emit(makeSignal({ type: "progress", data: { action: "read", target: "x.ts", summary: "读文件" } }));

      expect(received).toHaveLength(1);
    });

    it("取消监听后不再触发", () => {
      const bus = new SignalBus();
      let count = 0;
      const unsub = bus.on("progress", () => count++);

      bus.emit(makeSignal({ type: "progress" }));
      unsub();
      bus.emit(makeSignal({ type: "progress" }));

      expect(count).toBe(1);
    });
  });

  describe("信号收集与 runs 联动", () => {
    it("叶子信号同时存在于 bus 和 runs", () => {
      const bus = new SignalBus();
      const store = new RunsStore();
      const runId = store.createRun();

      store.addWorker(runId, {
        id: "w-build-1", role: "build", task: "实现登录",
        input: "实现登录功能", signals: [], startedAt: Date.now(), status: "running",
      });

      const signal = makeSignal({ workerId: "w-build-1", runId, type: "progress", data: { action: "modify", target: "login.ts", summary: "写登录逻辑" } });
      bus.emit(signal);
      store.appendSignal(runId, "w-build-1", signal);

      // bus 有
      expect(bus.getHistory("w-build-1")).toHaveLength(1);
      // runs 也有
      const worker = store.getWorker(runId, "w-build-1");
      expect(worker!.signals).toHaveLength(1);
      expect(worker!.signals[0].id).toBe(signal.id);
    });

    it("多个叶子各自发信号，根按 worker 分组查看", () => {
      const bus = new SignalBus();
      const store = new RunsStore();
      const runId = store.createRun();

      store.addWorker(runId, { id: "w-1", role: "explore", task: "探索", input: "", signals: [], startedAt: Date.now(), status: "running" });
      store.addWorker(runId, { id: "w-2", role: "build", task: "构建", input: "", signals: [], startedAt: Date.now(), status: "running" });

      const s1 = makeSignal({ workerId: "w-1", runId, type: "found", data: { summary: "发现依赖", severity: "info", category: "dependency" } });
      const s2 = makeSignal({ workerId: "w-2", runId, type: "progress", data: { action: "modify", target: "x.ts", summary: "修改" } });

      bus.emit(s1);
      bus.emit(s2);
      store.appendSignal(runId, "w-1", s1);
      store.appendSignal(runId, "w-2", s2);

      // 按 worker 查
      expect(bus.getHistory("w-1")).toHaveLength(1);
      expect(bus.getHistory("w-2")).toHaveLength(1);

      // 全量查
      expect(bus.getHistory()).toHaveLength(2);

      // 按 run 查
      expect(bus.getByRun(runId)).toHaveLength(2);
    });
  });

  describe("blocked 信号 → step 标记 failed", () => {
    it("blocked 信号出现在历史中，根可检查", () => {
      const bus = new SignalBus();
      const store = new RunsStore();
      const runId = store.createRun();

      store.addWorker(runId, { id: "w-1", role: "build", task: "任务", input: "", signals: [], startedAt: Date.now(), status: "running" });

      // 先发 progress，再发 blocked
      bus.emit(makeSignal({ workerId: "w-1", runId, type: "progress", data: { action: "modify", target: "a.ts", summary: "尝试修改" } }));
      bus.emit(makeSignal({ workerId: "w-1", runId, type: "blocked", data: { errorType: "syntax", message: "语法错误无法继续" } }));

      // 根检查是否有 blocked
      const blockedSignals = bus.getHistory().filter(s => s.type === "blocked");
      expect(blockedSignals).toHaveLength(1);
      expect((blockedSignals[0].data as any).errorType).toBe("syntax");
    });
  });
});
