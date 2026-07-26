import { describe, expect, it } from "bun:test";
import { catalogModels, createTierDrafts, cycleCandidateThinking, formatCandidate, moveCandidate, renderCatalog, renderModelConfig, serializeTierDrafts } from "../src/tui/model-config-dialog.js";

const translate = (key: string, params?: Record<string, string | number>) => `${key}${params ? JSON.stringify(params) : ""}`;

describe("/dteam model configuration view", () => {
  it("保留候选链顺序与每候选 thinking，并可序列化回配置", () => {
    const drafts = createTierDrafts({
      T1: { primary: "anthropic/opus:xhigh", fallbackModels: ["amazon-bedrock/opus:high"] },
      T2: { primary: "openai/standard" },
      T3: { primary: "llama.cpp/local:low" },
    });

    expect(drafts.T1).toEqual([
      { model: "anthropic/opus", thinking: "xhigh" },
      { model: "amazon-bedrock/opus", thinking: "high" },
    ]);
    expect(serializeTierDrafts(drafts)).toEqual({
      T1: ["anthropic/opus:xhigh", "amazon-bedrock/opus:high"],
      T2: ["openai/standard"],
      T3: ["llama.cpp/local:low"],
    });
  });

  it("支持候选排序和 thinking 循环，且默认 thinking 不写入配置", () => {
    const candidates = [{ model: "provider/one" }, { model: "provider/two", thinking: "low" as const }];
    expect(moveCandidate(candidates, 0, 1).map(formatCandidate)).toEqual(["provider/two:low", "provider/one"]);
    expect(cycleCandidateThinking(candidates[0]!)).toEqual({ model: "provider/one", thinking: "off" });
    expect(formatCandidate({ model: "provider/one" })).toBe("provider/one");
  });

  it("只从 Pi 当前可用模型读取去重后的目录，并渲染配置和筛选目录", async () => {
    const models = await catalogModels({
      getAll: () => { throw new Error("不应读取未配置 provider 的全量目录"); },
      getAvailable: async () => [
        { provider: "z", id: "two", name: "Two" },
        { provider: "a", id: "one", name: "one" },
        { provider: "z", id: "two", name: "Two" },
      ],
    });
    expect(models.map((model) => model.ref)).toEqual(["a/one", "z/two"]);
    const drafts = createTierDrafts({ T1: { primary: "a/one" }, T2: { primary: "z/two" }, T3: { primary: "a/one" } });
    expect(renderModelConfig(drafts, "T1", true, 80, translate, "[▶ 模型配置]").join("\n")).toContain("[▶ 模型配置]");
    expect(renderModelConfig(drafts, "T1", true, 80, translate).join("\n")).toContain("T1 · 1. a/one");
    expect(renderCatalog(models, 0, "two", 80, translate).join("\n")).toContain("z/two");
  });
});
