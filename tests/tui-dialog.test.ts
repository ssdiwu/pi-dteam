import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { renderWorkerDetail, renderWorkerList } from "../src/tui/dteam-dialog.js";
import type { WorkerSnapshot } from "../src/runtime/types.js";

const base: WorkerSnapshot = {
  id: "worker-1", title: "检查文件", task: "读取文件", requestedTier: "T3", activeTier: "T3", fallbackTrail: [], state: "running", activeTools: ["read"],
};

describe("/dteam dialog rendering", () => {
  it("列表有包边、标题、计数、任务和状态信息", () => {
    const history = { ...base, id: "worker-2", title: "已完成", state: "completed" as const, result: "ok" };
    const lines = renderWorkerList([base, history]);
    const text = lines.join("\n");
    expect(lines[0]).toContain("╭");
    expect(text).toContain("dteam 工作列表");
    expect(text).toContain("2 个 worker");
    expect(text).toContain("检查文件");
    expect(text).toContain("读取文件");
    expect(text).toContain("已完成");
    expect(text).toContain("T3");
    expect(lines.at(-1)).toContain("╰");
  });

  it("空列表仍显示有意义的标题和空状态", () => {
    const lines = renderWorkerList([]);
    const text = lines.join("\n");
    expect(text).toContain("dteam 工作列表");
    expect(text).toContain("暂无 worker");
    expect(lines[0]).toContain("╭");
    expect(lines.at(-1)).toContain("╰");
  });

  it("窄宽度下长标题和多行内容仍保持包边宽度", () => {
    const lines = renderWorkerDetail({ ...base, title: "很长的 worker 标题 ".repeat(8), task: "第一行\n第二行", latestFinding: "发现\n详情" }, undefined, 30);
    expect(lines.every((line) => visibleWidth(line) <= 30)).toBe(true);
    expect(lines.every((line) => !line.includes("\n"))).toBe(true);
    expect(lines[0]).toContain("╭");
    expect(lines.at(-1)).toContain("╯");
  });

  it("运行中详情有包边、接管/取消，终态详情只读封存", () => {
    const lines = renderWorkerDetail(base);
    const text = lines.join("\n");
    expect(lines[0]).toContain("╭");
    expect(text).toContain("检查文件");
    expect(text).toContain("读取文件");
    expect(text).toContain("接管");
    expect(lines.at(-1)).toContain("╰");
    const terminal = renderWorkerDetail({ ...base, state: "failed", error: "failed" });
    expect(terminal.join("\n")).toContain("只读封存");
    expect(terminal.join("\n")).not.toContain("取消（需确认）");
  });

  it("详情渲染实时文本、thinking、工具和 timeout 诊断，耗时使用 s/mXs", () => {
    const live: WorkerSnapshot = {
      ...base,
      liveText: "正在检查",
      liveThinking: "分析中",
      liveTool: "read",
      lastActivity: "运行工具 read",
      startedAt: Date.now() - 90_000,
      timeoutDiagnostic: { requestId: "r", totalBudgetMs: 300_000, attemptBudgetMs: 300_000, maxRecoveryBudgetMs: 600_000, elapsedMs: 90_000, lastActivity: "运行工具 read", currentTool: "read", outputSummary: "部分输出" },
    };
    const text = renderWorkerDetail(live).join("\n");
    expect(text).toContain("实时输出：正在检查");
    expect(text).toContain("思考：分析中");
    expect(text).toContain("当前工具：read");
    expect(text).toContain("超时诊断");
    expect(text).toContain("5m0s");
    expect(text).toContain("1m30s");
    expect(text).not.toContain("90000ms");
  });

  it("列表渲染实时输出、thinking、工具、最后活动和 timeout 诊断", () => {
    const live: WorkerSnapshot = {
      ...base,
      liveTool: "grep",
      liveText: "搜索中",
      liveThinking: "分析中",
      lastActivity: "运行工具 grep",
      timeoutDiagnostic: { requestId: "r", totalBudgetMs: 300_000, attemptBudgetMs: 300_000, maxRecoveryBudgetMs: 600_000, elapsedMs: 90_000, lastActivity: "运行工具 grep", currentTool: "grep", outputSummary: "部分输出" },
    };
    const text = renderWorkerList([live]).join("\n");
    expect(text).toContain("当前工具：grep");
    expect(text).toContain("实时输出：搜索中");
    expect(text).toContain("思考：分析中");
    expect(text).toContain("最后活动：运行工具 grep");
    expect(text).toContain("超时诊断");
  });

  it("宽度小于 20 时也不越界", () => {
    for (const width of [10, 19]) {
      const lines = renderWorkerList([{ ...base, liveThinking: "很长的思考" }], undefined, 0, width);
      expect(lines.every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });
});
