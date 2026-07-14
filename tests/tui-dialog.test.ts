import { describe, expect, it } from "vitest";
import { visibleWidth } from "@earendil-works/pi-tui";
import { clampSelection, nextScrollOffset, nextWorkerSelection, renderWorkerDetail, renderWorkerFallback, renderWorkerList, workersForView } from "../src/tui/dteam-dialog.js";
import type { WorkerSnapshot } from "../src/runtime/types.js";

const base: WorkerSnapshot = {
  id: "worker-1", title: "检查文件", task: "读取文件", requestedTier: "T3", activeTier: "T3", fallbackTrail: [], state: "running", activeTools: ["read"],
};

function worker(index: number, state: WorkerSnapshot["state"] = "running"): WorkerSnapshot {
  return { ...base, id: `worker-${index}`, title: `Worker ${index}`, state, startedAt: index };
}

describe("/dteam dialog rendering", () => {
  it("默认只显示运行中 worker，并把终态 worker 留给历史视图", () => {
    const history = { ...base, id: "worker-2", title: "已完成", state: "completed" as const, result: "ok" };
    const lines = renderWorkerList([base, history]);
    const text = lines.join("\n");
    expect(lines[0]).toContain("╭");
    expect(text).toContain("dteam 工作列表");
    expect(text).toContain("运行中 (1)");
    expect(text).toContain("历史记录 (1)");
    expect(text).toContain("检查文件");
    expect(text).not.toContain("已完成");
    expect(lines.at(-1)).toContain("╰");
  });

  it("历史视图倒序显示终态 worker，运行中 worker 不混入", () => {
    const older = { ...worker(1, "completed"), endedAt: 10 };
    const newer = { ...worker(2, "failed"), endedAt: 20 };
    const text = renderWorkerList([base, newer, older], undefined, 0, 80, undefined, "history").join("\n");
    expect(text).toContain("Worker 2");
    expect(text).toContain("Worker 1");
    expect(text.indexOf("Worker 2")).toBeLessThan(text.indexOf("Worker 1"));
    expect(text).not.toContain("检查文件");
  });

  it("非交互降级同时输出运行中与历史记录", () => {
    const history = { ...worker(2, "completed"), endedAt: 20 };
    const text = renderWorkerFallback([base, history]).join("\n");
    expect(text).toContain("检查文件");
    expect(text).toContain("Worker 2");
  });

  it("两个视图各有明确空状态", () => {
    expect(renderWorkerList([]).join("\n")).toContain("当前没有运行中的 worker");
    expect(renderWorkerList([], undefined, 0, 80, undefined, "history").join("\n")).toContain("暂无历史 worker");
  });

  it("超长 worker 列表保持有界，并随选择滚动到末尾", () => {
    const items = Array.from({ length: 20 }, (_, index) => worker(index + 1));
    const lines = renderWorkerList(items, undefined, 19);
    const text = lines.join("\n");
    expect(lines.length).toBeLessThanOrEqual(22);
    expect(text).toContain("Worker 20");
    expect(text).not.toContain("Worker 1 ·");
    expect(text).toContain("7-20/20");
  });

  it("列表选择支持方向键、vim 键、翻页与首尾跳转，并限制边界", () => {
    expect(nextWorkerSelection("j", 0, 20)).toBe(1);
    expect(nextWorkerSelection("\u001b[B", 19, 20)).toBe(19);
    expect(nextWorkerSelection("\u0004", 0, 20)).toBe(10);
    expect(nextWorkerSelection("G", 0, 20)).toBe(19);
    expect(nextWorkerSelection("\u001bOF", 0, 20)).toBe(19);
    expect(nextWorkerSelection("g", 19, 20)).toBe(0);
    expect(nextWorkerSelection("\u001bOH", 19, 20)).toBe(0);
    expect(nextWorkerSelection("x", 3, 20)).toBeNull();
    expect(clampSelection(8, 0)).toBe(0);
  });

  it("详情渲染保留接管/取消与终态只读，并支持通用滚动键位", () => {
    const lines = renderWorkerDetail(base);
    const text = lines.join("\n");
    expect(lines[0]).toContain("╭");
    expect(text).toContain("检查文件");
    expect(text).toContain("读取文件");
    expect(text).toContain("接管");
    expect(text).toContain("取消（需确认）");
    expect(lines.at(-1)).toContain("╰");
    expect(renderWorkerDetail({ ...base, state: "failed", error: "failed" }).join("\n")).toContain("只读封存");
    expect(nextScrollOffset("j", 0, 30)).toBe(1);
    expect(nextScrollOffset("G", 0, 30)).toBe(14);
    expect(nextScrollOffset("\u001bOF", 0, 30)).toBe(14);
    expect(nextScrollOffset("g", 14, 30)).toBe(0);
    expect(nextScrollOffset("\u001bOH", 14, 30)).toBe(0);
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

  it("窄宽度下两个视图和详情都不越界", () => {
    const history = { ...base, state: "completed" as const, title: "很长的历史 worker 标题 ".repeat(8) };
    for (const width of [10, 19]) {
      expect(renderWorkerList([base, history], undefined, 0, width).every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(renderWorkerList([base, history], undefined, 0, width, undefined, "history").every((line) => visibleWidth(line) <= width)).toBe(true);
      expect(renderWorkerDetail({ ...base, title: "很长的 worker 标题 ".repeat(8), task: "第一行\n第二行" }, undefined, width).every((line) => visibleWidth(line) <= width)).toBe(true);
    }
  });

  it("分类函数保持运行中与历史互斥", () => {
    const items = [worker(1, "queued"), worker(2, "waiting"), worker(3, "shutdown")];
    expect(workersForView(items, "active").map((item) => item.id)).toEqual(["worker-1", "worker-2"]);
    expect(workersForView(items, "history").map((item) => item.id)).toEqual(["worker-3"]);
  });
});
