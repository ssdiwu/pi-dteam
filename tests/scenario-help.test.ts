/**
 * 场景 2 集成测试：叶子 help → 根派 explore → 补充信息回传叶子
 *
 * 模拟完整流程：
 * 1. 叶子发 help 信号
 * 2. 根的 help listener 触发
 * 3. listener "派 explore"（模拟为直接 resolve）
 * 4. 叶子的 waitForSupplement 拿到补充信息
 */

import { describe, it, expect } from "vitest";
import { SignalBus } from "../src/signals/signal-bus.js";
import { RunsStore } from "../src/signals/runs-store.js";
import type { Signal, DteamContext } from "../src/tools.js";

function makeDteamContext(): DteamContext {
  const signalBus = new SignalBus();
  const runsStore = new RunsStore();
  const runId = runsStore.createRun();
  const pendingSupplements = new Map<string, (value: string | null) => void>();
  return { signalBus, runsStore, runId, workerId: "orchestrator", pendingSupplements };
}

function makeSignal(overrides: Partial<Signal> = {}): Signal {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    type: "help",
    workerId: "w-build-1",
    runId: "run-test",
    timestamp: Date.now(),
    data: { whatMissing: "配置文件路径", context: "不知道 config 在哪", urgency: "high", progressSummary: "刚开始", attemptsSummary: "试了 read", helpReason: "找不到配置" },
    ...overrides,
  };
}

describe("场景 2：help → explore → 补充信息回传", () => {
  it("叶子发 help → listener resolve → 叶子拿到补充", async () => {
    const dteam = makeDteamContext();
    const workerId = "w-build-1";

    // 注册 worker
    dteam.runsStore.addWorker(dteam.runId, {
      id: workerId, role: "build", task: "找配置",
      input: "找配置文件", signals: [], startedAt: Date.now(), status: "running",
    });

    // 模拟根的 help listener
    dteam.signalBus.on("help", async (s) => {
      // 模拟派 explore（实际是 resolve 叶子的 Promise）
      const resolve = dteam.pendingSupplements.get(s.workerId);
      if (resolve) {
        dteam.pendingSupplements.delete(s.workerId);
        resolve("配置文件在 src/config/default.json");
      }
    });

    // 模拟叶子的 waitForSupplement
    const supplementPromise = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => {
        if (dteam.pendingSupplements.has(workerId)) {
          dteam.pendingSupplements.delete(workerId);
          resolve(null);
        }
      }, 5000);
    });

    // 叶子发 help 信号
    const helpSignal = makeSignal({ workerId, runId: dteam.runId });
    dteam.signalBus.emit(helpSignal);

    // 等待补充信息
    const supplement = await supplementPromise;

    expect(supplement).toBe("配置文件在 src/config/default.json");
    expect(dteam.pendingSupplements.has(workerId)).toBe(false);
  });

  it("没有 help 信号 → waitForSupplement 超时 → 返回 null", async () => {
    const dteam = makeDteamContext();
    const workerId = "w-build-1";

    // 不发 help 信号，直接等超时
    const result = await new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => {
        if (dteam.pendingSupplements.has(workerId)) {
          dteam.pendingSupplements.delete(workerId);
          resolve(null);
        }
      }, 100); // 短超时
    });

    expect(result).toBeNull();
  });

  it("explore 失败 → resolve null → 叶子拿到 null 退出循环", async () => {
    const dteam = makeDteamContext();
    const workerId = "w-build-1";

    // 模拟 explore 失败的 listener
    dteam.signalBus.on("help", async (s) => {
      const resolve = dteam.pendingSupplements.get(s.workerId);
      if (resolve) {
        dteam.pendingSupplements.delete(s.workerId);
        resolve(null);
      }
    });

    const supplementPromise = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => {
        if (dteam.pendingSupplements.has(workerId)) {
          dteam.pendingSupplements.delete(workerId);
          resolve(null);
        }
      }, 5000);
    });

    dteam.signalBus.emit(makeSignal({ workerId, runId: dteam.runId }));
    const supplement = await supplementPromise;

    expect(supplement).toBeNull();
  });

  it("多轮 help：第一轮 + 第二轮", async () => {
    const dteam = makeDteamContext();
    const workerId = "w-build-1";
    let round = 0;

    dteam.signalBus.on("help", async (s) => {
      round++;
      const resolve = dteam.pendingSupplements.get(s.workerId);
      if (resolve) {
        dteam.pendingSupplements.delete(s.workerId);
        resolve(`第 ${round} 轮补充`);
      }
    });

    // 第一轮
    const p1 = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => { dteam.pendingSupplements.delete(workerId); resolve(null); }, 5000);
    });
    dteam.signalBus.emit(makeSignal({ workerId, runId: dteam.runId, timestamp: Date.now() }));
    const s1 = await p1;
    expect(s1).toBe("第 1 轮补充");

    // 第二轮
    const p2 = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => { dteam.pendingSupplements.delete(workerId); resolve(null); }, 5000);
    });
    dteam.signalBus.emit(makeSignal({ workerId, runId: dteam.runId, timestamp: Date.now() + 1 }));
    const s2 = await p2;
    expect(s2).toBe("第 2 轮补充");
  });
});
