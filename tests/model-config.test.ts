import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadDteamConfig } from "../src/session/model-config.js";

const root = join(tmpdir(), `pi-dteam-config-${process.pid}`);

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("pi-dteam.json model configuration", () => {
  it("要求 T1/T2/T3 三档主模型", () => {
    expect(loadDteamConfig(join(root, "missing.json"))).toMatchObject({ valid: false, exists: false, missingTiers: ["T1", "T2", "T3"] });
  });

  it("读取 primary 与 fallbackModels", () => {
    mkdirSync(root, { recursive: true });
    const path = join(root, "pi-dteam.json");
    writeFileSync(path, JSON.stringify({ tiers: {
      T1: { model: "openai-codex/gpt-5.6-terra", fallbackModels: ["openai-codex/gpt-5.6-luna"] },
      T2: { model: "openai-codex/gpt-5.6-luna" },
      T3: { model: "openai-codex/gpt-5.3-codex-spark" },
    }}));
    expect(loadDteamConfig(path)).toMatchObject({
      valid: true,
      routes: {
        T1: { primary: "openai-codex/gpt-5.6-terra", fallbackModels: ["openai-codex/gpt-5.6-luna"] },
        T2: { primary: "openai-codex/gpt-5.6-luna" },
        T3: { primary: "openai-codex/gpt-5.3-codex-spark" },
      },
    });
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
