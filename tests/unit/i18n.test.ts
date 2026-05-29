/**
 * i18n 单元测试
 */

import { describe, it, expect } from "vitest";
import { detectLocale, languageForLocale, languageInstructionForLocale } from "../../src/P0/i18n.js";
import { t } from "../../src/P1/i18n.js";

describe("i18n", () => {
  describe("P0/i18n", () => {
    it("detectLocale 从环境变量检测 locale", () => {
      expect(detectLocale({ PI_LOCALE: "zh-CN" })).toBe("zh-CN");
      expect(detectLocale({ LC_ALL: "en_US.UTF-8" })).toBe("en-US");
      expect(detectLocale({ LANG: "ja_JP.UTF-8" })).toBe("ja-JP");
      expect(detectLocale({})).toBeUndefined();
    });

    it("languageForLocale 映射到支持的语言", () => {
      expect(languageForLocale("zh-CN")).toBe("zh-Hans");
      expect(languageForLocale("zh-TW")).toBe("zh-Hant");
      expect(languageForLocale("en-US")).toBe("en");
      expect(languageForLocale("ja-JP")).toBe("ja");
      expect(languageForLocale(undefined)).toBe("zh-Hans");
    });

    it("languageInstructionForLocale 生成语言指令", () => {
      expect(languageInstructionForLocale("zh-CN")).toContain("简体中文");
      expect(languageInstructionForLocale("en-US")).toContain("English");
      expect(languageInstructionForLocale("ja-JP")).toContain("日本語");
    });
  });

  describe("P1/i18n", () => {
    it("t 翻译函数", () => {
      expect(t("status.pending", "zh-CN")).toBe("准备中");
      expect(t("status.pending", "en-US")).toBe("Pending");
      expect(t("status.pending", "ja-JP")).toBe("準備中");
    });

    it("t fallback 到 zh-Hans", () => {
      // 测试一个在德语中没有翻译的键
      expect(t("role.explore", "de-DE")).toBe("探索者");
    });

    it("t fallback 到 key 本身", () => {
      expect(t("unknown.key", "zh-CN")).toBe("unknown.key");
    });
  });
});
