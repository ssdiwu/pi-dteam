import { describe, expect, it } from "vitest";
import { renderWorkerDetail, renderWorkerList } from "../src/tui/dteam-dialog.js";
import type { WorkerSnapshot } from "../src/runtime/types.js";

const base: WorkerSnapshot = {
  id: "worker-1", title: "检查文件", task: "读取文件", requestedTier: "T3", activeTier: "T3", fallbackTrail: [], state: "running", activeTools: ["read"],
};

describe("/dteam dialog rendering", () => {
  it("列表展示运行中与历史 worker、档位和状态", () => {
    const history = { ...base, id: "worker-2", title: "已完成", state: "completed" as const, result: "ok" };
    const lines = renderWorkerList([base, history]);
    expect(lines.join("\n")).toContain("检查文件");
    expect(lines.join("\n")).toContain("completed");
    expect(lines.join("\n")).toContain("T3");
  });

  it("运行中详情有 steering/cancel，终态详情只读封存", () => {
    expect(renderWorkerDetail(base).join("\n")).toContain("steering");
    const terminal = renderWorkerDetail({ ...base, state: "failed", error: "failed" });
    expect(terminal.join("\n")).toContain("read-only archive");
    expect(terminal.join("\n")).not.toContain("c cancel");
  });
});
