/**
 * Phase 3 测试：Adaptive Concurrency + Multi-Provider Routing
 */

import { describe, it, expect } from "vitest";
import { AdaptiveConcurrency, DEFAULT_CONCURRENCY_CONFIG } from "../src/dispatch/concurrency.js";
import { resolveModelWithFallback, isRateLimitError } from "../src/dispatch/model-routing.js";
import type { Tier } from "../src/types/dispatch.js";

describe("AdaptiveConcurrency (Phase 3)", () => {
  it("未指定 initial 时起始并发 = min", () => {
    const c = new AdaptiveConcurrency({ min: 2, max: 5, cooldownMs: 0, successStreakToRise: 2 });
    expect(c.limit).toBe(2);
    expect(c.flying).toBe(0);
  });

  it("默认配置以 initial=2 允许首批 T3 fan-out", () => {
    const c = new AdaptiveConcurrency(DEFAULT_CONCURRENCY_CONFIG);
    expect(c.limit).toBe(2);
    expect(c.acquire()).toBe(true);
    expect(c.acquire()).toBe(true);
    expect(c.hasSlot()).toBe(false);
  });

  it("acquire 占用槽位，hasSlot 反映剩余", () => {
    const c = new AdaptiveConcurrency({ ...DEFAULT_CONCURRENCY_CONFIG, min: 2, max: 5, cooldownMs: 0, successStreakToRise: 99 });
    expect(c.acquire()).toBe(true);
    expect(c.acquire()).toBe(true);
    expect(c.flying).toBe(2);
    expect(c.hasSlot()).toBe(false);
    expect(c.acquire()).toBe(false); // 槽满
  });

  it("release 成功 → 连续成功足够后升并发", () => {
    const c = new AdaptiveConcurrency({ ...DEFAULT_CONCURRENCY_CONFIG, min: 1, initial: 1, max: 5, cooldownMs: 0, successStreakToRise: 2 });
    expect(c.limit).toBe(1);
    c.acquire();
    c.release(true); // streak=1
    expect(c.limit).toBe(1); // 还没到 2
    c.acquire();
    c.release(true); // streak=2 → 升
    expect(c.limit).toBe(2);
  });

  it("recordRateLimit 立即降并发 + 进入冷却", () => {
    const c = new AdaptiveConcurrency({ ...DEFAULT_CONCURRENCY_CONFIG, min: 1, initial: 1, max: 5, cooldownMs: 10_000, successStreakToRise: 1 });
    // successStreakToRise=1：每次 release success 升 1，从 min=1 起
    // 4 次 → limit 依次 1→2→3→4→5（max 封顶）
    for (let i = 0; i < 4; i++) { c.acquire(); c.release(true); }
    expect(c.limit).toBe(5);
    c.recordRateLimit();
    expect(c.limit).toBe(4); // 降 1
    expect(c.isCoolingDown()).toBe(true);
  });

  it("冷却期内不升并发", () => {
    const c = new AdaptiveConcurrency({ ...DEFAULT_CONCURRENCY_CONFIG, min: 1, initial: 1, max: 5, cooldownMs: 10_000, successStreakToRise: 1 });
    c.recordRateLimit();
    // 冷却期内连续成功也不升
    c.acquire(); c.release(true);
    expect(c.limit).toBe(1); // 仍是降后的 1
  });

  it("release 失败清零 successStreak", () => {
    const c = new AdaptiveConcurrency({ ...DEFAULT_CONCURRENCY_CONFIG, min: 1, initial: 1, max: 5, cooldownMs: 0, successStreakToRise: 2 });
    c.acquire(); c.release(true); // streak=1
    c.acquire(); c.release(false); // 失败，streak=0
    c.acquire(); c.release(true); // streak=1
    expect(c.limit).toBe(1); // 没升（需要连续 2 次）
  });
});

describe("resolveModelWithFallback (Phase 3 Multi-Provider)", () => {
  // modelRegistry mock：getAll 返回空，find 只认特定串，让 resolveModelStr 走 find/getModel 都失败
  const registry = {
    find: (provider: string, id: string) => {
      if (provider === "provider" && id === "good") return { id: "good", provider };
      if (provider === "fb" && id === "ok") return { id: "ok", provider };
      return undefined;
    },
    getAll: () => [],
  };

  it("用 tier 覆盖的主模型", () => {
    const { model, modelStr } = resolveModelWithFallback(
      "T2" as Tier, registry, { provider: "default", id: "d" },
      { T2: "provider/good" },
    );
    expect(modelStr).toBe("provider/good");
    expect(model).toBeTruthy();
  });

  it("主模型优先于 fallback（主模型可解析时用主模型）", () => {
    const { model, modelStr } = resolveModelWithFallback(
      "T2" as Tier, registry, { provider: "default", id: "d" },
      { T2: "provider/good" },
      { T2: ["fb/ok"] },
    );
    expect(modelStr).toBe("provider/good"); // 主模型可解析，不走 fallback
    expect(model).toBeTruthy();
  });

  it("无 tier 覆盖 → 用默认模型", () => {
    const { modelStr } = resolveModelWithFallback(
      "T3" as Tier, registry, { provider: "provider", id: "good" },
    );
    expect(modelStr).toBe("provider/good");
  });

  it("无候选模型串时返回 null", () => {
    // 不提供任何覆盖/fallback/默认模型
    const { model, modelStr } = resolveModelWithFallback(
      "T2" as Tier, registry, undefined, undefined, undefined,
    );
    expect(model).toBeNull();
    expect(modelStr).toBeNull();
  });
});

describe("isRateLimitError", () => {
  it("识别 429", () => {
    expect(isRateLimitError(new Error("429 Too Many Requests"))).toBe(true);
    expect(isRateLimitError(new Error("rate limit exceeded"))).toBe(true);
    expect(isRateLimitError(new Error("normal error"))).toBe(false);
  });
});
