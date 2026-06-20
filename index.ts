/**
 * dteam v1 — Pi 扩展入口
 *
 * 暴露 1 个工具给主 LLM：
 *   - dteam(action="run", goal="...")  → 同步阻塞跑完一个 goal
 *
 * 注册 1 个命令：
 *   - /dteam → 切换面板（展开/折叠/切换 tab）
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Text, truncateToWidth } from "@earendil-works/pi-tui";
import { runLoop } from "./src/orchestrator-loop.js";
import { defaultReporter } from "./src/reporter.js";
import {
  clearWidget,
  handlePanelCommand,
  isPanelExpanded,
  renderWidget,
  renderWidgetIfChanged,
} from "./src/ui/index.js";


// ---------------------------------------------------------------------------
// widget 刷新定时器
// ---------------------------------------------------------------------------
//
// 设计：500ms 心跳检查 uiStore 内容指纹。
// - 内容没变 → 跳过 setWidget，避免在部分 TUI 场景里刷屏
// - 内容变了 → 重新渲染；不为了 duration 秒表强制重绘

const REFRESH_TIMER_KEY = "__piDteamRefreshTimer";
type DteamGlobal = typeof globalThis & { [REFRESH_TIMER_KEY]?: ReturnType<typeof setInterval> | null };

function dteamGlobal(): DteamGlobal {
  return globalThis as DteamGlobal;
}

let refreshTimer: ReturnType<typeof setInterval> | null = dteamGlobal()[REFRESH_TIMER_KEY] ?? null;

function startRefresh(ctx: any) {
  stopRefresh();
  renderWidget(ctx);
  refreshTimer = setInterval(() => renderWidgetIfChanged(ctx), 500);
  dteamGlobal()[REFRESH_TIMER_KEY] = refreshTimer;
}

function stopRefresh() {
  if (refreshTimer) clearInterval(refreshTimer);
  refreshTimer = null;
  dteamGlobal()[REFRESH_TIMER_KEY] = null;
}

// ---------------------------------------------------------------------------
// dteam 工具结果的自定义渲染（中文化）
// ---------------------------------------------------------------------------


function renderDteamResult(result: any, options: { expanded: boolean; isPartial?: boolean }, theme: any): any {
  const w = (process.stdout.columns || 80) - 4;

  if (result.isError) {
    const text = result.content?.[0]?.text ?? "未知错误";
    return new Text(theme.fg("error", `✗ dteam 失败: ${text}`), 0, 0);
  }

  if (options.isPartial) {
    const text = result.content?.[0]?.text ?? "dteam 正在执行…";
    return new Text(theme.fg("info", text), 0, 0);
  }

  let parsed: any = null;
  const raw = result.content?.[0]?.text;
  try {
    if (typeof raw === "string" && raw.trim()) parsed = JSON.parse(raw);
    else if (raw && typeof raw === "object") parsed = raw;
  } catch { /* fallback */ }

  if (!parsed) {
    const text = typeof raw === "string" && raw.trim() ? raw : "dteam 结果未知";
    return new Text(theme.fg("info", `⚙ dteam · ${truncateToWidth(text, w, "…")}`), 0, 0);
  }

  // 0.6.0 DteamResult6（同步前台 Loop 返回）
  const icon = parsed.status === "done" ? "✓" : "✗";
  const color = parsed.status === "done" ? "success" : "error";
  const trail = Array.isArray(parsed.trail) ? parsed.trail : [];
  const checkTag = parsed.checkPassed ? " · check✓" : parsed.checkPassed === false ? " · check✗" : "";
  const summaryCn = `${parsed.summary ?? ""}${checkTag}`;
  const expandHint = theme.fg("dim", ` (Ctrl+O 展开)`);
  if (!options.expanded) {
    return new Text(theme.fg(color, `${icon} dteam · ${summaryCn}`) + expandHint, 0, 0);
  }
  const lines = [
    theme.fg(color, `${icon} dteam 0.6.0 · ${summaryCn}`),
    theme.fg("dim", `  目标: ${truncateToWidth(parsed.goal ?? "", w - 6, "…")}`),
  ];
  for (const s of trail) {
    const si = s.status === "done" ? "✓" : s.status === "failed" ? "✗" : "◐";
    const title = truncateToWidth(`[${s.role}] ${s.task ?? ""}`, w - 8, "…");
    lines.push(theme.fg("dim", `  ${si} ${title}`));
  }
  if (parsed.checkRound !== undefined) {
    lines.push(theme.fg("dim", `  check: ${parsed.checkPassed ? "通过" : "未通过"} (轮次 ${parsed.checkRound})`));
  }
  return new Text(lines.join("\n"), 0, 0);
}



// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  stopRefresh();
  pi.on("session_shutdown", () => {
    stopRefresh();
  });

  // ═══ 注册 dteam 工具 ═══
  pi.registerTool({
    name: "dteam",
    label: "dteam",
    description:
      "dteam 是基于 goal 自发生长的多 worker 群策群力扩展（0.6.0 召唤池）。用于需要召唤多个专业角色（explore/design/build/check/close）协作的复杂任务；简单任务应由主 LLM 直接完成。" +
      "调用 dteam 的场景：用户明确说“用 dteam/走 dteam/交给 dteam”；需要群策群力（多专业角色协作）的版本实施、多模块、有验收门禁的任务。" +
      "不要调用 dteam 的场景：普通问答、代码解释、方案评审但不实施、单文件小改、typo/文案修正、只跑一个命令。" +
      "action=run 启动同步前台 Orchestrator Loop（阻塞当前对话直到 check 收口完成，返回召唤轨迹和收口结论）。" +
      "建议传 availableTools（你当前可用的工具名列表），dteam 用它做 worker 工具验证。", 
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run"], description: "run=启动同步前台 Orchestrator Loop（0.6.0，阻塞直到 check 收口）" },
        goal: { type: "string", description: "要完成的目标" },
        availableTools: {
          type: "array",
          items: { type: "string" },
          description: "可选：调用方当前可用的工具名列表（仅 run 需要）。dteam 会用此列表验证子任务选用的工具是否存在；建议传，避开 v0.4.0 硬编码 ROLE_DEFAULTS 的限制。",
        },
      },
      required: ["action"],
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, goal, availableTools } = params as {
        action: string; goal?: string; availableTools?: string[];
      };

      // ── run：0.6.0 同步前台 Orchestrator Loop ──
      // 阻塞当前对话直到 check 收口完成，返回 DteamResult6
      if (action !== "run") {
        return { content: [{ type: "text" as const, text: `dteam: 未知操作 "${action}"（0.6.0 仅支持 run）` }], isError: true, details: {} };
      }
      if (!ctx.model) {
        return { content: [{ type: "text" as const, text: "dteam: 当前会话没有可用模型" }], isError: true, details: {} };
      }
      if (!goal) {
        return { content: [{ type: "text" as const, text: "dteam: run 需要 goal 参数" }], isError: true, details: {} };
      }
      ctx.ui.notify(`dteam: 进入 0.6.0 Orchestrator Loop`, "info");
      ctx.ui.setStatus("dteam", `0.6.0 Loop: ${goal}`);
        try {
          const result = await runLoop(goal!, {
            cwd: ctx.cwd || process.cwd(),
            modelRegistry: ctx.modelRegistry,
            model: ctx.model,
            availableTools,
          });
          ctx.ui.setStatus("dteam", undefined);
          ctx.ui.notify(`dteam: ${result.status === "done" ? "完成" : "失败"} — ${result.summary}`, result.status === "done" ? "info" : "error");
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                status: result.status,
                goal: result.goal,
                version: result.version,
                summonCount: result.summonTrail.length,
                trail: result.summonTrail.map(s => ({ role: s.role, status: s.status, task: s.task.slice(0, 80) })),
                checkPassed: result.checkConclusion.passed,
                checkRound: result.checkConclusion.round,
                summary: result.summary,
                elapsedMs: result.elapsedMs,
              }, null, 2),
            }],
            details: { version: result.version, result },
          };
        } catch (e) {
          ctx.ui.setStatus("dteam", undefined);
          ctx.ui.notify(`dteam: 0.6.0 Loop 失败 — ${(e as Error).message}`, "error");
          return { content: [{ type: "text" as const, text: `dteam run 失败: ${(e as Error).message}` }], isError: true, details: {} };
        }

      return { content: [{ type: "text" as const, text: `dteam: 未处理 action "${action}"` }], isError: true, details: {} };
    },
    renderResult(result: any, options: { expanded: boolean }, theme: any) {
      return renderDteamResult(result, options, theme);
    },
  });

  // ═══ 注册 /dteam 命令 → widget 面板 ═══
  pi.registerCommand("dteam", {
    description: "切换 dteam 面板（/dteam 展开，/dteam 1 切换 tab，/dteam close 关闭）",
    async handler(args, ctx) {
      handlePanelCommand(args, ctx);
    },
  });
}
