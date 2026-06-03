/**
 * dteam v1 — Pi 扩展入口
 *
 * 暴露 1 个工具给主 LLM：
 *   - dteam(action="run", goal="...")  → 同步阻塞跑完一个 goal
 *
 * 注册 1 个命令：
 *   - /dteam → toggle 面板（展开/折叠/空态）
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Container, Text } from "@earendil-works/pi-tui";
import { run } from "./src/orchestrator.js";
import { uiStore } from "./src/ui-store.js";
import { renderWidget, clearWidget, togglePanel, WIDGET_KEY } from "./src/ui-panel.js";
import { statusIcon, truncText } from "./src/ui-render.js";
import type { RunResult } from "./src/tools.js";

/** widget 刷新定时器 */
let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh(ctx: any) {
  stopRefresh();
  renderWidget(ctx);
  refreshTimer = setInterval(() => renderWidget(ctx), 500);
}

function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

/** dteam 工具结果的自定义渲染（中文化） */
function renderDteamResult(result: any, options: { expanded: boolean }, theme: any): any {
  const c = new Container();
  const w = (process.stdout.columns || 80) - 4;

  if (result.isError) {
    const text = result.content?.[0]?.text ?? "未知错误";
    c.addChild(new Text(theme.fg("error", `✗ dteam 失败: ${truncText(text, w - 20)}`), 0, 0));
    return c;
  }

  let parsed: RunResult | null = null;
  try {
    const raw = result.content?.[0]?.text;
    if (raw) parsed = JSON.parse(raw);
  } catch { /* fallback */ }

  if (!parsed) {
    c.addChild(new Text(theme.fg("success", `✓ dteam 完成`), 0, 0));
    return c;
  }

  const { status, goal: runGoal, plan, steps } = parsed;
  const icon = status === "done" ? "✓" : "✗";
  const color = status === "done" ? "success" : "error";
  const done = steps?.filter(t => t.status === "done").length ?? 0;
  const failed = steps?.filter(t => t.status === "failed").length ?? 0;
  const total = steps?.length ?? 0;
  const goalText = runGoal ?? "";

  // 第一行：✓ dteam · 4/4 完成
  const summaryCn = failed > 0 ? `${done}/${total} 完成, ${failed} 失败` : `${done}/${total} 完成`;
  const modeLabel = plan?.mode ? `${plan.mode} · ` : "";
  c.addChild(new Text(theme.fg(color, `${icon} dteam · ${modeLabel}${summaryCn}`), 0, 0));

  if (options.expanded && steps?.length) {
    for (const item of steps) {
      const si = statusIcon(item.status);
      const roleLabel = item.role ? `${item.role}: ` : "";
      const stratLabel = item.strategy && item.strategy !== "direct" ? ` (${item.strategy}${item.rounds ? `×${item.rounds}` : ""})` : "";
      const title = truncText(`${roleLabel}${item.task}`, w - 10);
      c.addChild(new Text(theme.fg("dim", `  ${si} ${title}${stratLabel}`), 0, 0));
      if (item.output) {
        const resultLine = truncText(item.output.split("\n")[0] ?? "", w - 8);
        c.addChild(new Text(theme.fg("dim", `    ⎿ ${resultLine}`), 0, 0));
      }
    }
  } else {
    c.addChild(new Text(theme.fg("dim", `  ⎿ ${truncText(goalText, w - 6)}`), 0, 0));
  }

  return c;
}

export default function (pi: ExtensionAPI) {
  // ═══ 注册 dteam 工具 ═══
  pi.registerTool({
    name: "dteam",
    label: "dteam",
    description:
      "通过 dteam 递归 worker 树端到端执行一个目标。根 worker 在每一层通过 LLM 决定是否分解，" +
      "然后派发叶子 worker 执行。同步阻塞：全部完成或失败后返回。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run"], description: "执行动作，目前只支持 run" },
        goal: { type: "string", description: "要完成的目标" },
      },
      required: ["action", "goal"],
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, goal } = params as { action: string; goal: string };

      if (action !== "run") {
        return {
          content: [{ type: "text" as const, text: `dteam: 未知操作 "${action}"` }],
          isError: true,
          details: {},
        };
      }

      if (!ctx.model) {
        return {
          content: [{ type: "text" as const, text: "dteam: 当前会话没有可用模型" }],
          isError: true,
          details: {},
        };
      }

      ctx.ui.notify(`dteam: 开始执行 "${goal}"`, "info");
      ctx.ui.setStatus("dteam", `执行中: ${goal}`);

      startRefresh(ctx);

      try {
        const result = await run(goal, ctx);
        ctx.ui.setStatus("dteam", undefined);
        renderWidget(ctx);

        // 3 秒后停止刷新 + 清除折叠态（展开面板不受影响）
        setTimeout(() => {
          stopRefresh();
          // 只在面板没展开时清除
          const state = uiStore.getState();
          if (!state.goal) {
            if (ctx.hasUI) ctx.ui.setWidget(WIDGET_KEY, undefined);
          }
        }, 3000);

        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: {},
        };
      } catch (e) {
        ctx.ui.setStatus("dteam", undefined);
        stopRefresh();
        clearWidget(ctx);
        return {
          content: [{ type: "text" as const, text: `dteam 失败: ${(e as Error).message}` }],
          isError: true,
          details: {},
        };
      }
    },
    renderResult(result: any, options: { expanded: boolean }, theme: any) {
      return renderDteamResult(result, options, theme);
    },
  });

  // ═══ 注册 /dteam 命令（toggle 面板） ═══
  pi.registerCommand("dteam", {
    description: "切换 dteam worker 进度面板",
    async handler(_args, ctx) {
      togglePanel(ctx);
    },
  });
}
