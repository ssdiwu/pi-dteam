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
import { run } from "./src/orchestrator.js";
import { uiStore } from "./src/ui-store.js";
import { renderWidget, WIDGET_KEY } from "./src/ui-widget.js";

/** widget 刷新定时器 */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

/** 面板是否展开 */
let panelOpen = false;

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
  });

  // ═══ 注册 /dteam 命令 ═══
  pi.registerCommand("dteam", {
    description: "Show dteam worker progress panel",
    async run(_args, ctx) {
      const state = uiStore.getState();
      if (!state.goal) {
        ctx.ui.notify("dteam: no active run", "info");
        return;
      }

      // 切换面板
      panelOpen = !panelOpen;
      if (panelOpen) {
        startWidgetRefresh(ctx);
        ctx.ui.notify("dteam: widget refresh started", "info");
      } else {
        stopWidgetRefresh();
        if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
        ctx.ui.notify("dteam: widget closed", "info");
      }
    },
  });
}
