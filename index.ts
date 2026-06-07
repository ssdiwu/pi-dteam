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
import { Container, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { run } from "./src/orchestrator.js";
import { SignalBus, RunsStore } from "./src/signals/index.js";
import {
  uiStore,
  handlePanelCommand,
  renderWidget,
  renderWidgetIfChanged,
  clearWidget,
  WIDGET_KEY,
} from "./src/ui/index.js";
import type { RunResult } from "./src/tools.js";

// ---------------------------------------------------------------------------
// widget 刷新定时器
// ---------------------------------------------------------------------------
//
// 设计：500ms 心跳检查 uiStore 内容指纹（+ 每秒至少刷一次让耗时走动）。
// - 内容没变 → 跳过 setWidget，避免无意义重绘
// - 内容变了 / 时间到 1s → 重新渲染
// - run 结束 / 显式 reset 时调 forceRefreshWidget() 强制重置 fingerprint

let refreshTimer: ReturnType<typeof setInterval> | null = null;

function startRefresh(ctx: any) {
  stopRefresh();
  renderWidget(ctx);
  refreshTimer = setInterval(() => renderWidgetIfChanged(ctx, 1000), 500);
}

function stopRefresh() {
  if (refreshTimer) { clearInterval(refreshTimer); refreshTimer = null; }
}

/** run 结束/reset 时强制同步 fingerprint（避免旧 fp 阻塞下一次 startRefresh） */
function forceRefreshWidget(ctx: any) {
  renderWidget(ctx);
}

// ---------------------------------------------------------------------------
// dteam 工具结果的自定义渲染（中文化）
// ---------------------------------------------------------------------------

function statusIcon(s: string): string {
  return (
    { pending: "◦", running: "⚒", done: "✓", failed: "✗", in_progress: "⚒" }[s] ?? "?"
  );
}

function renderDteamResult(result: any, options: { expanded: boolean }, theme: any): any {
  const w = (process.stdout.columns || 80) - 4;

  if (result.isError) {
    const text = result.content?.[0]?.text ?? "未知错误";
    return new Text(theme.fg("error", `✗ dteam 失败: ${text}`), 0, 0);
  }

  let parsed: any = null;
  try {
    const raw = result.content?.[0]?.text;
    if (raw) parsed = JSON.parse(raw);
  } catch { /* fallback */ }

  if (!parsed) {
    return new Text(theme.fg("success", `✓ dteam 完成`), 0, 0);
  }

  // 后台运行中（action=run 立即返回）
  if (parsed.status === "running") {
    const expandHint = theme.fg("dim", ` (Ctrl+O 展开)`);
    if (!options.expanded) {
      return new Text(
        theme.fg("info", `⚙ dteam 后台执行中`) +
        (parsed.runId ? theme.fg("dim", ` · runId ${parsed.runId}`) : "") +
        expandHint,
        0, 0,
      );
    }
    // expanded：显示完整信息
    const lines = [
      theme.fg("info", "⚙ dteam 后台执行中"),
      theme.fg("dim", `  runId: ${parsed.runId ?? ""}`),
      theme.fg("dim", "  输入 /dteam 查看实时进度面板"),
    ];
    return new Text(lines.join("\n"), 0, 0);
  }

  // 完整 RunResult（run 完成时 dteam 在 tool 内部不返回，但理论上可能）
  const { status, goal: runGoal, plan, steps } = parsed;
  const icon = status === "done" ? "✓" : "✗";
  const color = status === "done" ? "success" : "error";
  const done = steps?.filter((t: any) => t.status === "done").length ?? 0;
  const failed = steps?.filter((t: any) => t.status === "failed").length ?? 0;
  const total = steps?.length ?? 0;
  const goalText = runGoal ?? "";

  const summaryCn = failed > 0 ? `${done}/${total} 完成, ${failed} 失败` : `${done}/${total} 完成`;
  const modeLabel = plan?.mode ? `${plan.mode} · ` : "";
  const expandHint = theme.fg("dim", ` (Ctrl+O 展开)`);

  if (!options.expanded) {
    return new Text(
      theme.fg(color, `${icon} dteam · ${modeLabel}${summaryCn}`) + expandHint,
      0, 0,
    );
  }

  // expanded：完整
  const lines = [
    theme.fg(color, `${icon} dteam · ${modeLabel}${summaryCn}`),
    theme.fg("dim", `  目标: ${truncateToWidth(goalText, w, "…")}`),
  ];
  if (options.expanded && steps?.length) {
    for (const item of steps) {
      const si = statusIcon(item.status);
      const roleLabel = item.role ? `${item.role}: ` : "";
      const stratLabel = item.strategy && item.strategy !== "direct" ? ` (${item.strategy}${item.rounds ? `×${item.rounds}` : ""})` : "";
      const title = truncateToWidth(`${roleLabel}${item.task}`, w - 10, "…");
      lines.push(theme.fg("dim", `  ${si} ${title}${stratLabel}`));
      if (item.output) {
        const resultLine = truncateToWidth(item.output.split("\n")[0] ?? "", w - 8, "…");
        lines.push(theme.fg("dim", `    ⎿ ${resultLine}`));
      }
    }
  } else {
    lines.push(theme.fg("dim", `  ⎿ ${truncateToWidth(goalText, w - 6, "…")}`));
  }
  return new Text(lines.join("\n"), 0, 0);
}

// ---------------------------------------------------------------------------
// 后台 Run 管理
// ---------------------------------------------------------------------------

interface ActiveRun {
  runId: string;
  goal: string;
  ctx: any;
  dteam: import("./src/tools.js").DteamContext;
  promise: Promise<import("./src/tools.js").RunResult>;
  resolveResult: ((result: import("./src/tools.js").RunResult) => void) | null;
  status: "running" | "done" | "failed";
  result?: import("./src/tools.js").RunResult;
}

const activeRuns = new Map<string, ActiveRun>();

function cleanupRun(runId: string) {
  const run = activeRuns.get(runId);
  if (!run) return;
  delete run.ctx.dteam;
  activeRuns.delete(runId);
}

// ---------------------------------------------------------------------------
// 扩展注册
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
  // ═══ 注册 dteam-report 消息渲染器（折叠/展开） ═══
  pi.registerMessageRenderer("dteam-report", (message, { expanded }, theme) => {
    const details = message.details as {
      runId: string;
      status: string;
      summary: string;
      steps: Array<{ role: string; status: string; output: string }>;
    } | undefined;

    if (!details) {
      return new Text(theme.fg("success", message.content as string), 0, 0);
    }

    const icon = details.status === "done" ? "✓" : "✗";
    const color = details.status === "done" ? "success" : "error";

    // 折叠态：一行摘要
    let text = theme.fg(color, `${icon} dteam · ${details.summary}`);
    if (!expanded) {
      text += theme.fg("dim", ` (Ctrl+O 展开)`);
      return new Text(text, 0, 0);
    }

    // 展开态：步骤详情
    const w = (process.stdout.columns || 80) - 4;
    for (const s of details.steps) {
      const si = statusIcon(s.status);
      const output = s.output ? truncateToWidth(s.output.split("\n")[0] ?? "", w - 8, "…") : "(无输出)";
      text += `\n${theme.fg("dim", `  ${si} ${s.role}: ${output}`)}`;
    }

    return new Text(text, 0, 0);
  });

  // ═══ 注册 dteam 工具 ═══
  pi.registerTool({
    name: "dteam",
    label: "dteam",
    description:
      "通过 dteam 递归 worker 树端到端执行一个目标。支持后台运行，不阻塞前台。" +
      "action=run 启动后台执行，立即返回 runId；" +
      "action=continue 用户回复后注入信息让暂停的叶子继续。" +
      "提示：调用 run 时建议传 availableTools（你当前可用的工具名列表），dteam 会用它做工具验证，避免硬编码 ROLE_DEFAULTS 的限制。",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run", "continue"], description: "run=启动后台执行，continue=用户回复后注入" },
        goal: { type: "string", description: "要完成的目标（仅 run 需要）" },
        runId: { type: "string", description: "run ID（仅 continue 需要）" },
        message: { type: "string", description: "用户给 dteam 的回复（仅 continue 需要）" },
        availableTools: {
          type: "array",
          items: { type: "string" },
          description: "可选：调用方当前可用的工具名列表（仅 run 需要）。dteam 会用此列表验证子任务选用的工具是否存在；建议传，避开 v0.4.0 硬编码 ROLE_DEFAULTS 的限制。",
        },
      },
      required: ["action"],
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, goal, runId, message, availableTools } = params as {
        action: string; goal?: string; runId?: string; message?: string;
        availableTools?: string[];
      };

      // ── continue：用户回复后注入到暂停的叶子 ──
      if (action === "continue") {
        if (!runId || !message) {
          return { content: [{ type: "text" as const, text: "dteam: continue 需要 runId 和 message" }], isError: true, details: {} };
        }
        const run = activeRuns.get(runId);
        if (!run) {
          return { content: [{ type: "text" as const, text: `dteam: run ${runId} 不存在或已结束` }], isError: true, details: {} };
        }

        // 找到所有等待中的 pendingSupplements，resolve 第一个
        // （通常只有一个叶子在等人类）
        for (const [workerId, resolve] of run.dteam.pendingSupplements) {
          run.dteam.pendingSupplements.delete(workerId);
          resolve(message);
          break;
        }

        return { content: [{ type: "text" as const, text: `已注入到 run ${runId}，叶子继续执行` }], details: {} };
      }

      // ── run：启动后台执行 ──
      if (action !== "run") {
        return { content: [{ type: "text" as const, text: `dteam: 未知操作 "${action}"` }], isError: true, details: {} };
      }

      if (!ctx.model) {
        return { content: [{ type: "text" as const, text: "dteam: 当前会话没有可用模型" }], isError: true, details: {} };
      }

      if (!goal) {
        return { content: [{ type: "text" as const, text: "dteam: run 需要 goal 参数" }], isError: true, details: {} };
      }

      // 创建信号通路
      const signalBus = new SignalBus();
      const runsStore = new RunsStore();
      const newRunId = runsStore.createRun();
      const dteamCtx = { signalBus, runsStore, runId: newRunId, workerId: "orchestrator", pendingSupplements: new Map<string, (value: string | null) => void>(), injectionQueue: new Map<string, string[]>() };

      // 构建 run context（浅拷贝，不污染主对话 ctx）
      // 0.4.1：把 availableTools 挂到 runCtx，orchestrator/planner 会读它
      const runCtx = { ...ctx, dteam: dteamCtx, dteamAvailableTools: availableTools };

      ctx.ui.notify(`dteam: 后台开始执行`, "info");
      ctx.ui.setStatus("dteam", `执行中: ${goal}`);
      startRefresh(runCtx);

      // 后台跑（不 await）
      let activeRunResolve: ((result: import("./src/tools.js").RunResult) => void) | null = null;
      const activeRun: ActiveRun = {
        runId: newRunId,
        goal: goal!,
        ctx: runCtx,
        dteam: dteamCtx,
        promise: new Promise<import("./src/tools.js").RunResult>((resolve) => { activeRunResolve = resolve; }),
        resolveResult: null,
        status: "running",
      };
      activeRun.resolveResult = activeRunResolve;
      activeRuns.set(newRunId, activeRun);

      // 异步执行
      (async () => {
        try {
          const result = await run(goal!, runCtx);
          activeRun.status = "done";
          activeRun.result = result;
          activeRunResolve!(result);

          ctx.ui.setStatus("dteam", undefined);
          ctx.ui.notify(`dteam: 完成 — ${result.summary}`, "info");
          stopRefresh();

          // 清空 uiStore + 重新渲染 widget（让面板内容变空）
          uiStore.reset();
          if (ctx.hasUI) {
            ctx.ui.setWidget(WIDGET_KEY, undefined);
            // renderWidget 会在 uiStore 为空时返回空内容
            renderWidget(ctx);
          }

          // 通知主 LLM 完成 + 渲染到对话（折叠态一行，展开态显示步骤）
          try {
            pi.sendMessage(
              {
                customType: "dteam-report",
                content: `dteam run ${newRunId} 已完成`,
                display: true,
                details: {
                  runId: newRunId,
                  status: result.status,
                  summary: result.summary,
                  steps: result.steps.map((s: any) => ({
                    role: s.role,
                    status: s.status,
                    output: s.output?.slice(0, 500) ?? "",
                  })),
                },
              },
              { triggerTurn: true, deliverAs: "followUp" },
            );
          } catch (e) {
            console.error("[dteam] sendMessage 失败:", e);
          }
        } catch (e) {
          activeRun.status = "failed";
          activeRunResolve!({
            status: "failed", goal: goal!, plan: { mode: "solo" as const, reason: `异常: ${(e as Error).message}`, steps: [] },
            steps: [], summary: (e as Error).message,
          });
          ctx.ui.setStatus("dteam", undefined);
          ctx.ui.notify(`dteam: 失败 — ${(e as Error).message}`, "error");
          stopRefresh();
          clearWidget(runCtx);
        } finally {
          cleanupRun(newRunId);
        }
      })();

      // 立即返回 runId（不返回 goal，避免和 tool 参数重复显示）
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ status: "running", runId: newRunId }) }],
        details: {},
      };
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
