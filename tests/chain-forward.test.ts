/**
 * 链式继承 + 实时转发测试
 *
 * 链式继承：派下一个 step 前，把前序 found/progress 信号摘要注入到任务描述。
 * 实时转发：跑中叶子发的 found/progress → 经根转发到其他正在跑的叶子。
 *
 * 【可观察测试点】
 *  - historyContext 包含 "[L<id> <type>]" 前缀
 *  - injectionQueue 在转发后长度 + 1
 *  - uiStore.strategies 末尾出现 "转发 <type> from X → Y" 记录
 */

import { describe, it, expect, beforeEach } from "vitest";
import { SignalBus } from "../src/signals/signal-bus.js";
import { RunsStore } from "../src/signals/runs-store.js";
import { buildHistoryContext, forwardSignalToPeers } from "../src/orchestrator.js";
import { uiStore } from "../src/ui/index.js";
import type { Signal, DteamContext } from "../src/tools.js";

function makeDteam(): DteamContext {
  const signalBus = new SignalBus();
  const runsStore = new RunsStore();
  const runId = runsStore.createRun();
  return {
    signalBus,
    runsStore,
    runId,
    workerId: "orchestrator",
    pendingSupplements: new Map(),
    injectionQueue: new Map(),
  };
}

function makeWorker(runId: string, store: RunsStore, id: string, status: any = "running") {
  store.addWorker(runId, {
    id, role: "build", task: "test", input: "",
    signals: [], startedAt: Date.now(), status,
  });
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    type: "progress",
    workerId: "w-A",
    runId: "run-1",
    timestamp: Date.now(),
    data: { action: "read", target: "x.ts", summary: "完成读取" },
    ...overrides,
  };
}

describe("链式继承：buildHistoryContext", () => {
  it("无信号时返回 null", () => {
    const dteam = makeDteam();
    expect(buildHistoryContext(dteam, 0, "build")).toBeNull();
  });

  it("found 信号 → 包含 [workerId found]", () => {
    const dteam = makeDteam();
    dteam.signalBus.emit(makeSignal({ type: "found", data: { summary: "发现 X", severity: "info", category: "dependency" } }));
    const ctx = buildHistoryContext(dteam, 1, "build")!;
    expect(ctx).toContain("[w-A found] 发现 X");
    expect(ctx).toContain("(总计 1 条)");
  });

  it("progress 信号带动作词 → 包含", () => {
    const dteam = makeDteam();
    dteam.signalBus.emit(makeSignal({ type: "progress", data: { action: "create", target: "a.ts", summary: "完成创建" } }));
    const ctx = buildHistoryContext(dteam, 1, "build")!;
    expect(ctx).toContain("[w-A progress] 完成创建");
  });

  it("progress 信号不带动作词 → 排除", () => {
    const dteam = makeDteam();
    dteam.signalBus.emit(makeSignal({ type: "progress", data: { action: "read", target: "a.ts", summary: "读取" } }));
    expect(buildHistoryContext(dteam, 1, "build")).toBeNull();
  });

  it("blocked/help 信号 → 排除", () => {
    const dteam = makeDteam();
    dteam.signalBus.emit(makeSignal({ type: "blocked", data: { errorType: "syntax", message: "错误" } }));
    dteam.signalBus.emit(makeSignal({ type: "help", data: { whatMissing: "配置", context: "无", urgency: "high", progressSummary: "1", attemptsSummary: "无", helpReason: "卡" } }));
    expect(buildHistoryContext(dteam, 1, "build")).toBeNull();
  });

  it("多个信号 → 都包含并显示总数", () => {
    const dteam = makeDteam();
    dteam.signalBus.emit(makeSignal({ workerId: "w-A", type: "found", data: { summary: "发现1", severity: "info", category: "dependency" } }));
    dteam.signalBus.emit(makeSignal({ workerId: "w-B", type: "found", data: { summary: "发现2", severity: "info", category: "risk" } }));
    const ctx = buildHistoryContext(dteam, 1, "build")!;
    expect(ctx).toContain("[w-A found]");
    expect(ctx).toContain("[w-B found]");
    expect(ctx).toContain("(总计 2 条)");
  });
});

describe("实时转发：forwardSignalToPeers", () => {
  beforeEach(() => {
    uiStore.reset();
  });

  it("found 信号转发给所有 running peer（排除自己）", () => {
    const dteam = makeDteam();
    makeWorker(dteam.runId, dteam.runsStore, "w-A");
    makeWorker(dteam.runId, dteam.runsStore, "w-B");
    makeWorker(dteam.runId, dteam.runsStore, "w-C");

    const signal = makeSignal({ workerId: "w-A", type: "found", data: { summary: "重要发现", severity: "info", category: "dependency" } });
    forwardSignalToPeers(dteam, signal, signal.data);

    // w-B 和 w-C 应该收到，w-A 不应该
    expect(dteam.injectionQueue.get("w-B")).toEqual(["[转发 found from w-A] 重要发现"]);
    expect(dteam.injectionQueue.get("w-C")).toEqual(["[转发 found from w-A] 重要发现"]);
    expect(dteam.injectionQueue.has("w-A")).toBe(false);
  });

  it("只转发给 running 状态的 worker", () => {
    const dteam = makeDteam();
    makeWorker(dteam.runId, dteam.runsStore, "w-A");
    makeWorker(dteam.runId, dteam.runsStore, "w-B", "done");
    makeWorker(dteam.runId, dteam.runsStore, "w-C", "failed");

    const signal = makeSignal({ workerId: "w-A", type: "found", data: { summary: "X", severity: "info", category: "dependency" } });
    forwardSignalToPeers(dteam, signal, signal.data);

    expect(dteam.injectionQueue.has("w-B")).toBe(false);
    expect(dteam.injectionQueue.has("w-C")).toBe(false);
  });

  it("多次转发累加到队列（FIFO）", () => {
    const dteam = makeDteam();
    makeWorker(dteam.runId, dteam.runsStore, "w-A");
    makeWorker(dteam.runId, dteam.runsStore, "w-B");

    forwardSignalToPeers(dteam, makeSignal({ workerId: "w-A", type: "found", data: { summary: "第一次", severity: "info", category: "dependency" } }), { summary: "第一次", severity: "info", category: "dependency" });
    forwardSignalToPeers(dteam, makeSignal({ workerId: "w-A", type: "found", data: { summary: "第二次", severity: "info", category: "dependency" } }), { summary: "第二次", severity: "info", category: "dependency" });

    expect(dteam.injectionQueue.get("w-B")).toEqual([
      "[转发 found from w-A] 第一次",
      "[转发 found from w-A] 第二次",
    ]);
  });

  it("UI 记录转发动作", () => {
    const dteam = makeDteam();
    makeWorker(dteam.runId, dteam.runsStore, "w-A");
    makeWorker(dteam.runId, dteam.runsStore, "w-B");

    const signal = makeSignal({ workerId: "w-A", type: "found", data: { summary: "测试", severity: "info", category: "dependency" } });
    forwardSignalToPeers(dteam, signal, signal.data);

    const strategies = uiStore.getState().strategies;
    expect(strategies.length).toBe(1);
    expect(strategies[0].action).toBe("转发 found");
    expect(strategies[0].target).toBe("w-A → w-B");
  });

  it("空 summary → 不转发", () => {
    const dteam = makeDteam();
    makeWorker(dteam.runId, dteam.runsStore, "w-A");
    makeWorker(dteam.runId, dteam.runsStore, "w-B");

    const signal = makeSignal({ workerId: "w-A", type: "found", data: { summary: "", severity: "info", category: "dependency" } });
    forwardSignalToPeers(dteam, signal, signal.data);

    expect(dteam.injectionQueue.has("w-B")).toBe(false);
  });
});
