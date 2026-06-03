/**
 * P0-原子层单元测试
 */

import { describe, it, expect } from "vitest";
import { getOption, getRequiredOption, normalizeOptions } from "../../src/P0/config.js";
import { resolveDteamMemoryPath } from "../../src/P0/pathSafety.js";

describe("P0-原子层", () => {
  describe("config", () => {
    it("getOption 返回指定类型的值", () => {
      const options = [
        { type: "role" as const, value: "explore" },
        { type: "rounds" as const, value: 3 },
      ];

      expect(getOption<string>(options, "role")).toBe("explore");
      expect(getOption<number>(options, "rounds")).toBe(3);
      expect(getOption<boolean>(options, "voting")).toBeUndefined();
    });

    it("getOption 处理 undefined options", () => {
      expect(getOption<string>(undefined, "role")).toBeUndefined();
    });

    it("getRequiredOption 返回指定类型的值", () => {
      const options = [
        { type: "role" as const, value: "explore" },
      ];

      expect(getRequiredOption<string>(options, "role")).toBe("explore");
    });

    it("getRequiredOption 抛出错误当值不存在", () => {
      const options = [
        { type: "role" as const, value: "explore" },
      ];

      expect(() => getRequiredOption<string>(options, "rounds")).toThrow();
    });

    it("normalizeOptions 保留数组形态", () => {
      const options = [{ type: "role" as const, value: "build" }];
      expect(normalizeOptions(options)).toEqual(options);
    });

    it("normalizeOptions 支持 { item: option } 形态", () => {
      expect(normalizeOptions({ item: { type: "role", value: "check" } })).toEqual([
        { type: "role", value: "check" },
      ]);
    });

    it("normalizeOptions 支持 { item: option[] } 形态", () => {
      const options = [{ type: "rounds" as const, value: 2 }];
      expect(normalizeOptions({ item: options })).toEqual(options);
    });

    it("normalizeOptions 支持普通对象 values 形态", () => {
      expect(normalizeOptions({ 0: { type: "debug", value: true } })).toEqual([
        { type: "debug", value: true },
      ]);
    });

    it("normalizeOptions 对空值和非法值返回空数组", () => {
      expect(normalizeOptions(undefined)).toEqual([]);
      expect(normalizeOptions(null)).toEqual([]);
      expect(normalizeOptions("role")).toEqual([]);
    });
  });

  describe("resolveDteamMemoryPath", () => {
    const cwd = "/tmp/dteam-test";

    it("裸文件名 → 解析到 <cwd>/.dteam/memory/<name>.json", () => {
      expect(resolveDteamMemoryPath(cwd, "session.json")).toBe(
        "/tmp/dteam-test/.dteam/memory/session.json",
      );
    });

    it("子路径 → 允许", () => {
      expect(resolveDteamMemoryPath(cwd, "team/foo.json")).toBe(
        "/tmp/dteam-test/.dteam/memory/team/foo.json",
      );
    });

    it("含 .dteam/memory 前缀会报明确错误（防嵌套）", () => {
      expect(() => resolveDteamMemoryPath(cwd, ".dteam/memory/foo.json")).toThrow(
        /must not contain/,
      );
    });

    it("含 memory 段也会报明确错误", () => {
      expect(() => resolveDteamMemoryPath(cwd, "memory/foo.json")).toThrow(
        /must not contain/,
      );
    });

    it("非 .json 后缀报错", () => {
      expect(() => resolveDteamMemoryPath(cwd, "session.txt")).toThrow(
        /\.json/,
      );
    });

    it("绝对路径被拒绝（resolveInside 语义）", () => {
      expect(() => resolveDteamMemoryPath(cwd, "/etc/passwd.json")).toThrow();
    });
  });
});
