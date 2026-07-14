/** dteam 0.8 — 唯一模型工具 `dteam` 与用户管理命令 `/dteam`。 */
import type { ExtensionAPI, ExtensionCommandContext, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { AdaptiveConcurrency, DEFAULT_CONCURRENCY_CONFIG } from "./src/dispatch/concurrency.js";
import { WorkerManager } from "./src/runtime/worker-manager.js";
import { formatDteamConfigWarning, loadDteamConfig, type DteamConfigStatus } from "./src/session/model-config.js";
import type { DteamParams, ParentEvent } from "./src/runtime/types.js";
import { renderWorkerDetail, renderWorkerList } from "./src/tui/dteam-dialog.js";
import { setupI18n, t } from "./src/tui/i18n.js";
import { confirmWorkerCancellation } from "./src/tui/cancel.js";

function errorResult(message: string) {
  return { content: [{ type: "text" as const, text: `dteam: ${message}` }], isError: true, details: {} };
}

function managerFor(
  pi: ExtensionAPI,
  current: { manager?: WorkerManager; render?: () => void },
  ctx: ExtensionContext,
  config: DteamConfigStatus,
): WorkerManager {
  if (!config.valid) throw new Error(formatDteamConfigWarning(config));
  if (current.manager) return current.manager;
  const manager = new WorkerManager({
    cwd: ctx.cwd || process.cwd(),
    modelRegistry: ctx.modelRegistry,
    model: ctx.model,
    parentActiveTools: typeof pi.getActiveTools === "function" ? pi.getActiveTools() : (ctx as any).getActiveTools?.() ?? [],
    getParentActiveTools: () => typeof pi.getActiveTools === "function" ? pi.getActiveTools() : (ctx as any).getActiveTools?.() ?? [],
    tierModelRoutes: config.routes,
    concurrency: new AdaptiveConcurrency(DEFAULT_CONCURRENCY_CONFIG),
    onParentEvent: (event) => {
      sendParentEvent(pi, event, ctx.hasUI);
      const active = current.manager?.active().length ?? 0;
      ctx.ui?.setStatus?.("dteam", active > 0 ? t("status.active", { count: active }) : undefined);
    },
    onChange: () => current.render?.(),
  });
  current.manager = manager;
  return manager;
}

export function sendParentEvent(pi: ExtensionAPI, event: ParentEvent, hasUI = true): void {
  const text = JSON.stringify({ dteam: event.type, workerId: event.workerId, title: event.title, ...((event.payload && typeof event.payload === "object") ? event.payload : { payload: event.payload }) });
  pi.sendMessage?.({ customType: "dteam-worker", content: text, display: false, details: event }, { triggerTurn: hasUI, deliverAs: hasUI ? "followUp" : "nextTurn" });
}

function validateResponse(raw: any): { ok: true; value: any } | { ok: false; error: string } {
  if (raw?.type === "provide_context" && typeof raw.context === "string") return { ok: true, value: { type: raw.type, context: raw.context } };
  if (raw?.type === "grant_tools" && Array.isArray(raw.tools) && raw.tools.every((tool: unknown) => typeof tool === "string")) return { ok: true, value: { type: raw.type, tools: raw.tools } };
  if (raw?.type === "decision" && typeof raw.decision === "string") return { ok: true, value: { type: raw.type, decision: raw.decision } };
  if (raw?.type === "deny" && typeof raw.reason === "string") return { ok: true, value: { type: raw.type, reason: raw.reason } };
  return { ok: false, error: "respond response 字段不符合 type 对应 schema" };
}

function isParams(value: unknown): value is DteamParams {
  return !!value && typeof value === "object" && ((value as any).type === "dispatch" || (value as any).type === "respond");
}

export default function registerDteam(pi: ExtensionAPI) {
  const runtime: { manager?: WorkerManager; config?: DteamConfigStatus; render?: () => void } = {};
  setupI18n(pi, () => runtime.render?.());

  pi.on("session_start", (_event, ctx) => {
    runtime.manager?.shutdown();
    runtime.manager = undefined;
    runtime.config = loadDteamConfig();
    if (!runtime.config.valid) {
      ctx.ui?.notify?.(formatDteamConfigWarning(runtime.config), "warning");
      return;
    }
    managerFor(pi, runtime, ctx, runtime.config);
  });
  pi.on("session_shutdown", (_event, ctx) => {
    runtime.manager?.shutdown();
    runtime.manager = undefined;
    runtime.config = undefined;
    ctx.ui?.setStatus?.("dteam", undefined);
  });

  pi.registerTool({
    name: "dteam",
    label: "dteam",
    description: "dteam 模型分级后台 worker 工具。按推理复杂度选 tier：T3=明确、机械、可独立验证的小任务（默认只读）；T2=目标清楚的标准复杂度任务；T1=复杂推理、决策、综合、验收。T3/T2 遇硬失败会 fresh 回退 T1。用 type=dispatch 派发 1–32 个独立 worker（立即返回 queued，结果经 follow-up 回传），用 type=respond 回应 waiting worker 的结构化请求。主代理负责依赖理解、验收和后续路由；不要传依赖图、batch 或 goal/task 映射。",
    parameters: {
      type: "object",
      properties: {
        type: { type: "string", enum: ["dispatch", "respond"] },
        workers: { type: "array", minItems: 1, maxItems: 32, items: { type: "object", properties: { title: { type: "string" }, task: { type: "string" }, tier: { type: "string", enum: ["T1", "T2", "T3"] }, addTools: { type: "array", items: { type: "string" } } }, required: ["title", "task", "tier"] } },
        workerId: { type: "string" }, requestId: { type: "string" },
        response: { type: "object", properties: { type: { type: "string", enum: ["provide_context", "grant_tools", "decision", "deny"] }, context: { type: "string" }, tools: { type: "array", items: { type: "string" } }, decision: { type: "string" }, reason: { type: "string" } }, required: ["type"] },
      },
      required: ["type"],
    } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      if (!isParams(rawParams)) return errorResult("type 必须是 dispatch 或 respond");
      try {
        const config = runtime.config ?? loadDteamConfig();
        runtime.config = config;
        const manager = managerFor(pi, runtime, ctx, config);
        if (rawParams.type === "dispatch") {
          const accepted = manager.dispatch(rawParams.workers);
          ctx.ui?.setStatus?.("dteam", t("status.active", { count: manager.active().length }));
          return { content: [{ type: "text" as const, text: JSON.stringify({ accepted }, null, 2) }], details: { accepted } };
        }
        if (typeof rawParams.workerId !== "string" || typeof rawParams.requestId !== "string" || !rawParams.response || typeof rawParams.response.type !== "string") return errorResult("respond 需要 workerId、requestId 和 response");
        const response = validateResponse(rawParams.response);
        if (!response.ok) return errorResult(response.error);
        const result = manager.respond(rawParams.workerId, rawParams.requestId, response.value);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { result } };
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }
    },
  });

  pi.registerCommand("dteam", {
    description: "查看、接管或取消 dteam worker",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const config = runtime.config ?? loadDteamConfig();
      runtime.config = config;
      if (!config.valid) { ctx.ui.notify(formatDteamConfigWarning(config), "warning"); return; }
      const manager = managerFor(pi, runtime, ctx, config);
      if (!ctx.ui?.custom) { ctx.ui.notify(renderWorkerList(manager.list()).join("\n"), "info"); return; }
      try {
        await ctx.ui.custom((tui, theme, _kb, done) => {
          runtime.render = () => tui.requestRender();
          let selected = 0;
          let detail = false;
          const selectedWorker = () => manager.list()[selected];
          return {
            render: (width: number) => {
              const items = manager.list();
              if (detail && items[selected]) return renderWorkerDetail(items[selected]!, theme, width, t);
              return renderWorkerList(items, theme, selected, width, t);
            },
            invalidate: () => {},
            handleInput: (data: string) => {
              const items = manager.list();
              const worker = selectedWorker();
              if (data === "\u001b" || data === "q") return detail ? (detail = false) : done(undefined);
              if (!detail && (data === "\u001b[B" || data === "j")) selected = Math.min(Math.max(0, items.length - 1), selected + 1);
              if (!detail && (data === "\u001b[A" || data === "k")) selected = Math.max(0, selected - 1);
              if (!detail && data === "\r" && worker) detail = true;
              if (detail && data === "s" && worker && ["queued", "running", "waiting"].includes(worker.state)) {
                void ctx.ui.input(t("steering.title"), t("steering.placeholder"))
                  .then((instruction) => { if (instruction) return manager.steer(worker.id, instruction); })
                  .catch((error) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"));
              }
              if (detail && data === "c" && worker && ["queued", "running", "waiting"].includes(worker.state)) {
                void confirmWorkerCancellation(ctx.ui, manager, worker.id, worker.title, t)
                  .catch((error) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"));
              }
            },
          };
        }, {
          overlay: true,
          overlayOptions: { anchor: "center", width: "100%", maxHeight: "85%", margin: 1 },
        });
      } finally {
        runtime.render = undefined;
      }
    },
  });
}
