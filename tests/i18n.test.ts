import { describe, expect, it, vi } from "vitest";
import { setupI18n, t } from "../src/tui/i18n.js";

describe("dteam i18n integration", () => {
  it("只接受第一个有效 API，避免两个事件通道互相覆盖", () => {
    const first = { t: vi.fn((key: string) => key === "dteam.dialog.listTitle" ? "FIRST" : key), registerBundle: vi.fn() };
    const second = { t: vi.fn(() => "SECOND"), registerBundle: vi.fn() };
    const emit = vi.fn((event: string, payload: any) => {
      if (event === "pi-core/i18n/requestApi") payload.reply(first);
      if (event === "pi-i18n/requestApi") payload.reply(second);
    });
    const onChange = vi.fn();
    setupI18n({ events: { emit } } as any, onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(first.registerBundle).toHaveBeenCalledTimes(2);
    expect(second.registerBundle).not.toHaveBeenCalled();
    expect(t("dialog.listTitle")).toBe("FIRST");
  });
});
