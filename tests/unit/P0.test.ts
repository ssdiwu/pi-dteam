/**
 * P0-原子层单元测试
 */

import { describe, it, expect } from "vitest";
import { getOption, getRequiredOption } from "../../src/P0/config.js";

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
  });
});
