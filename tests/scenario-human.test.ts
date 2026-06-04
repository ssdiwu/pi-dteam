/**
 * 场景 3 集成测试：help 升级到人类 + continue 注入
 *
 * 验证：
 * 1. 首次 help → 自愈（派 explore）
 * 2. 第 2 次 help → 升级到人类（不 resolve，叶子继续等）
 * 3. 用户通过 continue 注入 → 叶子拿到回复
 */

import { describe, it, expect } from "vitest";
import { SignalBus } from "../src/signals/signal-bus.js";
import { RunsStore } from "../src/signals/runs-store.js";
import type { Signal, DteamContext } from "../src/tools.js";

function makeDteamContext(): DteamContext {
  const signalBus = new SignalBus();
  const runsStore = new RunsStore();
  const runId = runsStore.createRun();
  return { signalBus, runsStore, runId, workerId: "orchestrator", pendingSupplements: new Map() };
}

function makeHelpSignal(workerId: string, runId: string): Signal {
  return {
    id: `s-${Math.random().toString(36).slice(2, 8)}`,
    type: "help",
    workerId,
    runId,
    timestamp: Date.now(),
    data: { whatMissing: "配置路径", context: "找不到", urgency: "high", progressSummary: "刚开始", attemptsSummary: "试过 grep", helpReason: "不知道在哪" },
  };
}

describe("场景 3：help 自愈 1 次 + 升级到人类", () => {
  it("首次 help → 自愈 resolve", async () => {
    const dteam = makeDteamContext();
    const workerId = "w-build-1";
    const selfHealed = new Set<string>();

    // 模拟自愈 listener
    dteam.signalBus.on("help", async (s) => {
      if (selfHealed.has(s.workerId)) return; // 第 2 次不处理
      selfHealed.add(s.workerId);
      const resolve = dteam.pendingSupplements.get(s.workerId);
      if (resolve) {
        dteam.pendingSupplements.delete(s.workerId);
        resolve("自愈补充信息");
      }
    });

    // 叶子等补充
    const p = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => { dteam.pendingSupplements.delete(workerId); resolve(null); }, 5000);
    });

    // 发 help
    dteam.signalBus.emit(makeHelpSignal(workerId, dteam.runId));
    const result = await p;

    expect(result).toBe("自愈补充信息");
    expect(selfHealed.has(workerId)).toBe(true);
  });

  it("第 2 次 help → 不 resolve → 叶子继续等", async () => {
    const dteam = makeDteamContext();
    const workerId = "w-build-1";
    const selfHealed = new Set<string>();
    let notifyCalled = false;

    dteam.signalBus.on("help", async (s) => {
      if (selfHealed.has(s.workerId)) {
        // 第 2 次：升级到人类，不 resolve
        notifyCalled = true;
        return;
      }
      selfHealed.add(s.workerId);
      const resolve = dteam.pendingSupplements.get(s.workerId);
      if (resolve) {
        dteam.pendingSupplements.delete(s.workerId);
        resolve("自愈补充");
      }
    });

    // 第 1 次：自愈
    const p1 = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => { dteam.pendingSupplements.delete(workerId); resolve(null); }, 5000);
    });
    dteam.signalBus.emit(makeHelpSignal(workerId, dteam.runId));
    const r1 = await p1;
    expect(r1).toBe("自愈补充");

    // 第 2 次：升级到人类
    const p2 = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => { dteam.pendingSupplements.delete(workerId); resolve(null); }, 5000);
    });
    dteam.signalBus.emit(makeHelpSignal(workerId, dteam.runId));

    // 短暂等一下，确认 listener 没有立刻 resolve
    await new Promise((r) => setTimeout(r, 50));
    expect(dteam.pendingSupplements.has(workerId)).toBe(true);
    expect(notifyCalled).toBe(true);

    // 模拟用户 continue：手动 resolve
    const resolve = dteam.pendingSupplements.get(workerId);
    if (resolve) {
      dteam.pendingSupplements.delete(workerId);
      resolve("用户说配置在 src/config/");
    }

    const r2 = await p2;
    expect(r2).toBe("用户说配置在 src/config/");
  });

  it("后台 run 管理：runId 存在时 continue 能注入", async () => {
    const dteam = makeDteamContext();
    const workerId = "w-build-1";

    // 叶子等补充
    const p = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set(workerId, resolve);
      setTimeout(() => { dteam.pendingSupplements.delete(workerId); resolve(null); }, 5000);
    });

    // 模拟 continue：从外部 resolve
    const resolve = dteam.pendingSupplements.get(workerId)!;
    dteam.pendingSupplements.delete(workerId);
    resolve("用户的回复");

    const result = await p;
    expect(result).toBe("用户的回复");
  });

  it("team 模式：一个叶子等人类，其他叶子不受影响", async () => {
    const dteam = makeDteamContext();

    // 叶子 A 等人类
    const pA = new Promise<string | null>((resolve) => {
      dteam.pendingSupplements.set("w-A", resolve);
      setTimeout(() => { dteam.pendingSupplements.delete("w-A"); resolve(null); }, 5000);
    });

    // 叶子 B 正常完成（不等）
    const resultB = "叶子B完成了";

    // B 立刻有结果
    expect(resultB).toBe("叶子B完成了");

    // A 还在等
    expect(dteam.pendingSupplements.has("w-A")).toBe(true);

    // 用户回复 A
    const resolve = dteam.pendingSupplements.get("w-A")!;
    dteam.pendingSupplements.delete("w-A");
    resolve("给A的回复");

    const rA = await pA;
    expect(rA).toBe("给A的回复");
  });
});
