import { describe, expect, it, vi } from "vitest";
import { confirmWorkerCancellation } from "../src/tui/cancel.js";

describe("/dteam cancellation confirmation", () => {
  it("未确认不 abort/cancel", async () => {
    const manager = { cancel: vi.fn() };
    const ui = { confirm: vi.fn().mockResolvedValue(false) };
    await expect(confirmWorkerCancellation(ui, manager, "w", "worker")).resolves.toBe(false);
    expect(manager.cancel).not.toHaveBeenCalled();
  });

  it("确认后只用 user_cancelled 取消", async () => {
    const manager = { cancel: vi.fn() };
    const ui = { confirm: vi.fn().mockResolvedValue(true) };
    await expect(confirmWorkerCancellation(ui, manager, "w", "worker")).resolves.toBe(true);
    expect(ui.confirm).toHaveBeenCalledWith("取消 worker", "确认取消 worker？");
    expect(manager.cancel).toHaveBeenCalledWith("w", "user_cancelled");
  });
});
