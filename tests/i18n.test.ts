import { describe, expect, it , mock } from "bun:test";
import { setupI18n, t } from "../src/tui/i18n.js";

describe("dteam i18n integration", () => {
  it("只接受第一个有效 API，避免两个事件通道互相覆盖", () => {
    const first = { t: mock((key: string) => key === "dteam.dialog.listTitle" ? "FIRST" : key), registerBundle: mock() };
    const second = { t: mock(() => "SECOND"), registerBundle: mock() };
    const emit = mock((event: string, payload: any) => {
      if (event === "pi-core/i18n/requestApi") payload.reply(first);
      if (event === "pi-i18n/requestApi") payload.reply(second);
    });
    const onChange = mock();
    setupI18n({ events: { emit } } as any, onChange);
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(first.registerBundle).toHaveBeenCalledTimes(2);
    expect(second.registerBundle).not.toHaveBeenCalled();
    expect(t("dialog.listTitle")).toBe("FIRST");
  });
});
