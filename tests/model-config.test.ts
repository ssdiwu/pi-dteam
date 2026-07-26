import { afterEach, describe, expect, it } from "bun:test";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
const { loadDteamConfig, saveDteamConfig } = await import("../src/session/model-config.ts?model-config-test");

const root = join(tmpdir(), `pi-dteam-config-${process.pid}`);

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("pi-dteam.json model configuration", () => {
  it("要求 T1/T2/T3 三档主模型", () => {
    expect(loadDteamConfig(join(root, "missing.json"))).toMatchObject({ valid: false, exists: false, missingTiers: ["T1", "T2", "T3"] });
  });

  it("按 provider/model[:thinking] 顺序读取主模型与回退链", () => {
    mkdirSync(root, { recursive: true });
    const path = join(root, "pi-dteam.json");
    writeFileSync(path, JSON.stringify({ tiers: {
      T1: ["openai-codex/gpt-5.6-terra:high", "openai-codex/gpt-5.6-sol:high"],
      T2: ["openai-codex/gpt-5.6-luna:medium"],
      T3: ["openai-codex/gpt-5.3-codex-spark:low"],
    }}));
    expect(loadDteamConfig(path)).toMatchObject({
      valid: true,
      routes: {
        T1: { primary: "openai-codex/gpt-5.6-terra:high", fallbackModels: ["openai-codex/gpt-5.6-sol:high"] },
        T2: { primary: "openai-codex/gpt-5.6-luna:medium" },
        T3: { primary: "openai-codex/gpt-5.3-codex-spark:low" },
      },
    });
  });

  it("原子保存完整候选链，并返回可立即用于未来派发的路由", () => {
    const path = join(root, "nested", "pi-dteam.json");
    const saved = saveDteamConfig({
      T1: ["anthropic/opus:xhigh", "amazon-bedrock/opus:high"],
      T2: ["openai/standard:medium"],
      T3: ["llama.cpp/local:low"],
    }, path);
    expect(saved).toMatchObject({ valid: true, path, routes: { T1: { primary: "anthropic/opus:xhigh", fallbackModels: ["amazon-bedrock/opus:high"] } } });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ tiers: {
      T1: ["anthropic/opus:xhigh", "amazon-bedrock/opus:high"],
      T2: ["openai/standard:medium"],
      T3: ["llama.cpp/local:low"],
    } });
  });

  it("拒绝无效 provider/id", () => {
    mkdirSync(root, { recursive: true });
    const path = join(root, "pi-dteam.json");
    writeFileSync(path, JSON.stringify({ tiers: {
      T1: { model: "terra" }, T2: { model: "provider/t2" }, T3: { model: "provider/t3" },
    }}));
    expect(loadDteamConfig(path).valid).toBe(false);
    expect(loadDteamConfig(path).errors.join("\n")).toContain("T1.model");
  });
});
