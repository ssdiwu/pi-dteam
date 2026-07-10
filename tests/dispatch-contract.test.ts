import { describe, expect, it } from "vitest";
import { getTierThinking, getTierTools, TIER_DEFAULTS } from "../src/session/tier-config.js";
import { modelCandidates, resolveTierModelWithFallback } from "../src/dispatch/model-routing.js";

describe("T1/T2/T3 dispatch contract", () => {
  it("T3 默认只给不可写工具与低思考", () => {
    expect(TIER_DEFAULTS.T3.thinking).toBe("low");
    expect(getTierTools("T3")).toEqual(["read", "grep", "find", "ls"]);
    expect(getTierTools("T3")).not.toContain("bash");
    expect(getTierTools("T3")).not.toContain("edit");
    expect(getTierTools("T3")).not.toContain("write");
  });

  it("显式 tools 是权限上限，未知工具不会透传", () => {
    expect(getTierTools("T3", ["read", "edit", "not-installed", "edit"])).toEqual(["read", "edit"]);
    expect(getTierTools("T1", [])).toEqual([]);
  });

  it("thinking 缺省跟随档位，调用方可以显式覆盖", () => {
    expect(getTierThinking("T1")).toBe("high");
    expect(getTierThinking("T2")).toBe("medium");
    expect(getTierThinking("T3")).toBe("low");
    expect(getTierThinking("T3", "medium")).toBe("medium");
  });
});

describe("tier model routing", () => {
  const registry = {
    find(provider: string, id: string) {
      if (provider === "primary" && id === "ok") return { provider, id };
      if (provider === "fallback" && id === "ok") return { provider, id };
      if (provider === "ctx" && id === "model") return { provider, id };
      return undefined;
    },
    getAll: () => [],
  };

  it("未配置档位模型时才从 ctx.model 开始", () => {
    expect(modelCandidates("T3", { provider: "ctx", id: "model" })).toEqual(["ctx/model"]);
    const resolved = resolveTierModelWithFallback("T3", registry, { provider: "ctx", id: "model" });
    expect(resolved.modelStr).toBe("ctx/model");
  });

  it("显式 primary 与 FallbackModels 按声明顺序解析", () => {
    const resolved = resolveTierModelWithFallback(
      "T3",
      registry,
      { provider: "ctx", id: "model" },
      { T3: { primary: "missing/model", fallbackModels: ["fallback/ok"] } },
    );
    expect(resolved.modelStr).toBe("fallback/ok");
  });

  it("已配置 primary 时不静默降回 ctx.model", () => {
    const resolved = resolveTierModelWithFallback(
      "T2",
      registry,
      { provider: "ctx", id: "model" },
      { T2: { primary: "missing/model" } },
    );
    expect(resolved).toEqual({ model: null, modelStr: null });
  });
});
