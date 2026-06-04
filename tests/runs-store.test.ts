/**
 * runs-store.ts 单元测试
 */

import { describe, it, expect } from "vitest";
import { RunsStore } from "../src/signals/index.js";
import type { WorkerRun, Signal } from "../src/tools.js";

function makeWorker(overrides: Partial<WorkerRun> = {}): WorkerRun {
  return {
    id: `w-${Math.random().toString(36).slice(2, 8)}`,
    role: "build",
    task: "test task",
    input: "test input",
    signals: [],
    startedAt: Date.now(),
    status: "running",
    ...overrides,
  };
}

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

describe("RunsStore", () => {
  describe("createRun", () => {
    it("返回 runId 格式", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      expect(runId).toMatch(/^run-/);
    });

    it("每次返回不同的 runId", () => {
      const store = new RunsStore();
      const id1 = store.createRun();
      const id2 = store.createRun();
      expect(id1).not.toBe(id2);
    });
  });

  describe("addWorker / getWorker", () => {
    it("添加并获取 worker", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      const worker = makeWorker({ id: "w-1" });
      store.addWorker(runId, worker);
      const got = store.getWorker(runId, "w-1");
      expect(got).not.toBeNull();
      expect(got!.id).toBe("w-1");
    });

    it("不存在的 worker 返回 null", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      expect(store.getWorker(runId, "w-none")).toBeNull();
    });

    it("不存在的 run 返回 null", () => {
      const store = new RunsStore();
      expect(store.getWorker("run-none", "w-1")).toBeNull();
    });

    it("addWorker 到不存在的 run 抛错", () => {
      const store = new RunsStore();
      expect(() => store.addWorker("run-none", makeWorker())).toThrow("not found");
    });
  });

  describe("appendSignal", () => {
    it("追加信号到 worker", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      store.addWorker(runId, makeWorker({ id: "w-1" }));
      const sig = makeSignal();
      store.appendSignal(runId, "w-1", sig);
      const worker = store.getWorker(runId, "w-1");
      expect(worker!.signals).toHaveLength(1);
      expect(worker!.signals[0].id).toBe(sig.id);
    });

    it("多次追加", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      store.addWorker(runId, makeWorker({ id: "w-1" }));
      store.appendSignal(runId, "w-1", makeSignal());
      store.appendSignal(runId, "w-1", makeSignal());
      store.appendSignal(runId, "w-1", makeSignal());
      expect(store.getWorker(runId, "w-1")!.signals).toHaveLength(3);
    });

    it("不存在的 worker 抛错", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      expect(() => store.appendSignal(runId, "w-none", makeSignal())).toThrow("not found");
    });
  });

  describe("finishWorker", () => {
    it("标记完成", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      store.addWorker(runId, makeWorker({ id: "w-1" }));
      store.finishWorker(runId, "w-1", "done output", "done");
      const worker = store.getWorker(runId, "w-1");
      expect(worker!.status).toBe("done");
      expect(worker!.output).toBe("done output");
      expect(worker!.finishedAt).toBeDefined();
    });

    it("标记失败", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      store.addWorker(runId, makeWorker({ id: "w-1" }));
      store.finishWorker(runId, "w-1", "error msg", "failed");
      expect(store.getWorker(runId, "w-1")!.status).toBe("failed");
    });

    it("不存在的 worker 静默忽略", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      expect(() => store.finishWorker(runId, "w-none", "", "failed")).not.toThrow();
    });
  });

  describe("getAllWorkers", () => {
    it("返回所有 worker 快照", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      store.addWorker(runId, makeWorker({ id: "w-1" }));
      store.addWorker(runId, makeWorker({ id: "w-2" }));
      const all = store.getAllWorkers(runId);
      expect(all).toHaveLength(2);
      expect(all.map(w => w.id).sort()).toEqual(["w-1", "w-2"]);
    });

    it("不存在的 run 返回空数组", () => {
      const store = new RunsStore();
      expect(store.getAllWorkers("run-none")).toEqual([]);
    });

    it("返回快照不影响原数据", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      store.addWorker(runId, makeWorker({ id: "w-1" }));
      const all = store.getAllWorkers(runId);
      all[0].status = "done";
      expect(store.getWorker(runId, "w-1")!.status).toBe("running");
    });

    it("signals 也是快照", () => {
      const store = new RunsStore();
      const runId = store.createRun();
      store.addWorker(runId, makeWorker({ id: "w-1" }));
      store.appendSignal(runId, "w-1", makeSignal());
      const all = store.getAllWorkers(runId);
      all[0].signals.push(makeSignal());
      expect(store.getWorker(runId, "w-1")!.signals).toHaveLength(1);
    });
  });
});
