/**
 * dteam v1 — Pi 扩展入口
 *
 * 暴露 1 个工具给主 LLM：
 *   - dteam(action="run", goal="...")  → 同步阻塞跑完一个 goal
 *
 * 注册 1 个命令：
 *   - /dteam → 打开 worker 进度面板
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { run } from "./src/orchestrator.js";
import { uiStore } from "./src/ui-store.js";
import { renderWidget, WIDGET_KEY } from "./src/ui-widget.js";
import { statusIcon, formatDuration, truncText } from "./src/ui-render.js";
import type { RunResult } from "./src/tools.js";

/** widget 刷新定时器 */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** 刷新 widget（500ms 间隔调用） */
function startWidgetRefresh(ctx: any) {
  stopWidgetRefresh();
  renderWidget(ctx);
  refreshTimer = setInterval(() => {
    renderWidget(ctx);
  }, 500);
}

function stopWidgetRefresh() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
}

/** 构建 dteam 工具结果的自定义渲染（2 行摘要） */
function renderDteamResult(
  result: any,
  options: { expanded: boolean },
  theme: any,
): any {
  const c = new Container();
  const w = (process.stdout.columns || 80) - 4;

  if (result.isError) {
    const text = result.content?.[0]?.text ?? "unknown error";
    c.addChild(new Text(theme.fg("error", `✗ dteam failed: ${truncText(text, w - 20)}`), 0, 0));
    return c;
  }

  // 解析 RunResult
  let parsed: RunResult | null = null;
  try {
    const raw = result.content?.[0]?.text;
    if (raw) parsed = JSON.parse(raw);
  } catch { /* fallback */ }

  if (!parsed) {
    c.addChild(new Text(theme.fg("success", `✓ dteam done`), 0, 0));
    return c;
  }

  const { status, summary, workItems } = parsed;
  const icon = status === "done" ? "✓" : "✗";
  const color = status === "done" ? "success" : "error";
  const goal = workItems?.[0]?.title ?? "";

  // 第一行：状态 + 摘要
  c.addChild(new Text(
    theme.fg(color, `${icon} dteam: ${summary}`),
    0, 0,
  ));

  // 展开时：列出每个 worker
  if (options.expanded && workItems?.length) {
    for (const item of workItems) {
      const si = statusIcon(item.status);
      const title = truncText(item.title, w - 10);
      const line = `${si} ${title}`;
      c.addChild(new Text(theme.fg("dim", `  ${line}`), 0, 0));

      // 有结果的显示最后一行
      if (item.result) {
        const resultLine = truncText(
          item.result.split("\n")[0] ?? "",
          w - 8,
        );
        c.addChild(new Text(theme.fg("dim", `    ⎿ ${resultLine}`), 0, 0));
      }
    }
  } else {
    // 折叠时：只显示 goal
    c.addChild(new Text(
      theme.fg("dim", `  ⎿ ${truncText(goal, w - 6)}`),
      0, 0,
    ));
  }

  return c;
}

export default function (pi: ExtensionAPI) {
  // ═══ 注册 dteam 工具 ═══
  pi.registerTool({
    name: "dteam",
    label: "dteam",
    description:
      "Run a goal end-to-end through dteam's recursive worker tree. " +
      "The root worker decomposes the goal by asking an LLM at each level, " +
      "then dispatches leaf workers to do the work. " +
      "Synchronous: returns when everything is done or failed.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run"] },
        goal: { type: "string", description: "The goal to accomplish" },
      },
      required: ["action", "goal"],
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, goal } = params as { action: string; goal: string };

      if (action !== "run") {
        return {
          content: [{ type: "text" as const, text: `dteam: unknown action "${action}"` }],
          isError: true,
          details: {},
        };
      }

      if (!ctx.model) {
        return {
          content: [{ type: "text" as const, text: "dteam: no session model available" }],
          isError: true,
          details: {},
        };
      }

      ctx.ui.notify(`dteam: running "${goal}"`, "info");
      ctx.ui.setStatus("dteam", `running: ${goal}`);

      // 启动 widget 刷新
      startWidgetRefresh(ctx);

      try {
        const result = await run(goal, ctx);
        ctx.ui.setStatus("dteam", undefined);

        // 最后刷一次 widget，显示完成态
        renderWidget(ctx);

        // 3 秒后清除 widget
        setTimeout(() => {
          if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
        }, 3000);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: {},
        };
      } catch (e) {
        ctx.ui.setStatus("dteam", undefined);
        stopWidgetRefresh();
        return {
          content: [{ type: "text" as const, text: `dteam failed: ${(e as Error).message}` }],
          isError: true,
          details: {},
        };
      }
    },
    // 自定义结果渲染：折叠 2 行，展开列出所有 worker
    renderResult(result: any, options: { expanded: boolean }, theme: any) {
      return renderDteamResult(result, options, theme);
    },
  });

  // ═══ 注册 /dteam 命令 ═══
  pi.registerCommand("dteam", {
    description: "Show dteam worker progress panel",
    async handler(_args, ctx) {
      const state = uiStore.getState();
      if (!state.goal) {
        ctx.ui.notify("dteam: no active run", "info");
        return;
      }

      // 切换 widget
      startWidgetRefresh(ctx);
      ctx.ui.notify("dteam: widget refresh started", "info");
    },
  });
}
