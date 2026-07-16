/** dteam — 三个模型工具与用户管理命令 `/dteam`。 */
import { type ExtensionAPI, type ExtensionCommandContext, type ExtensionContext } from "@earendil-works/pi-coding-agent";
import { matchesKey, Text } from "@earendil-works/pi-tui";
import { AdaptiveConcurrency, DEFAULT_CONCURRENCY_CONFIG } from "./src/dispatch/concurrency.js";
import { DTEAM_CONFIG } from "./src/config.js";
import { WorkerManager } from "./src/runtime/worker-manager.js";
import { sanitizeUnknown } from "./src/runtime/sanitize.js";
import { formatDteamConfigWarning, loadDteamConfig, type DteamConfigStatus } from "./src/session/model-config.js";
import type { DteamDispatchParams, DteamRecoverParams, DteamRespondParams, DteamWaitParams, ParentEvent, RecoveryAction, WorkerRequest } from "./src/runtime/types.js";
import { clampSelection, detailLineCount, nextScrollOffset, nextWorkerSelection, renderWorkerDetail, renderWorkerFallback, renderWorkerList, workersForView, type WorkerView } from "./src/tui/dteam-dialog.js";
import { setupI18n, t } from "./src/tui/i18n.js";
import { confirmWorkerCancellation } from "./src/tui/cancel.js";
import { humanizeToolResult } from "./src/tui/tool-result.js";

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
  const payload = sanitizeUnknown(event.payload);
  const body = payload && typeof payload === "object" && !Array.isArray(payload) ? payload as Record<string, unknown> : { payload };
  const title = String(sanitizeUnknown(event.title));
  const text = JSON.stringify({ ...body, dteam: event.type, workerId: event.workerId, title });
  const details = { ...event, title, payload };
  pi.sendMessage?.({ customType: "dteam-worker", content: text, display: false, details }, { triggerTurn: hasUI, deliverAs: hasUI ? "followUp" : "nextTurn" });
}

function validateResponse(raw: any): { ok: true; value: DteamRespondParams["response"] } | { ok: false; error: string } {
  if (raw?.type === "provide_context" && typeof raw.context === "string") return { ok: true, value: { type: raw.type, context: raw.context } };
  if (raw?.type === "grant_tools" && Array.isArray(raw.tools) && raw.tools.every((tool: unknown) => typeof tool === "string")) return { ok: true, value: { type: raw.type, tools: raw.tools } };
  if (raw?.type === "grant_tool_budget" && typeof raw.additionalCalls === "number" && Number.isFinite(raw.additionalCalls)) return { ok: true, value: { type: raw.type, additionalCalls: raw.additionalCalls } };
  if (raw?.type === "decision" && typeof raw.decision === "string") return { ok: true, value: { type: raw.type, decision: raw.decision } };
  if (raw?.type === "deny" && typeof raw.reason === "string") return { ok: true, value: { type: raw.type, reason: raw.reason } };
  return { ok: false, error: "respond response 字段不符合 type 对应 schema" };
}

function isRespondParams(value: unknown): value is DteamRespondParams {
  return !!value && typeof value === "object" && typeof (value as any).workerId === "string" && typeof (value as any).requestId === "string" && !!(value as any).response;
}

function validateRecovery(raw: unknown): { ok: true; value: RecoveryAction } | { ok: false; error: string } {
  if (!raw || typeof raw !== "object" || typeof (raw as any).workerId !== "string" || typeof (raw as any).requestId !== "string") return { ok: false, error: "需要 workerId、requestId 和 action" };
  const value = raw as any;
  if (value.action === "retry") return { ok: true, value: { action: "retry" } };
  if (value.action === "escalate" && ["T1", "T2", "T3"].includes(value.tier)) return { ok: true, value: { action: "escalate", tier: value.tier } };
  if (value.action === "extend" && typeof value.additionalMs === "number" && Number.isFinite(value.additionalMs) && value.additionalMs > 0) return { ok: true, value: { action: "extend", additionalMs: value.additionalMs } };
  if (value.action === "stop" && (value.reason === undefined || typeof value.reason === "string")) return { ok: true, value: { action: "stop", ...(typeof value.reason === "string" ? { reason: value.reason } : {}) } };
  return { ok: false, error: "recover action 字段不符合对应 schema" };
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

  const toolDescription = "dteam 模型分级后台 worker 工具。主 LLM 负责理解、路由、证据筛选、冲突裁决和收口；T3 先做只读事实探测或经显式最小授权的机械小改，T2 处理已定位的常规实现，T1 只处理复杂判断、高风险收敛和验收。worker 必须通过内部 dteam_report 提交结构化报告；跨档仅传有界 handoff，不传完整会话或 worker P2P 消息。可写 worker 必须声明 writeScope；中断时主 LLM 必须派 fresh T3 检查 scope 的 diff、编译或定向测试。";
  const workerSchema = {
    type: "object",
    properties: {
      title: { type: "string" }, task: { type: "string" }, tier: { type: "string", enum: ["T1", "T2", "T3"] },
      addTools: { type: "array", items: { type: "string" } },
      writeScope: { type: "array", items: { type: "string" } },
      handoff: { type: "object", additionalProperties: false, properties: {
        facts: { type: "array", items: { type: "object", additionalProperties: false, properties: { claim: { type: "string" }, evidence: { type: "string" }, workerId: { type: "string" } }, required: ["claim", "evidence", "workerId"] } },
        constraints: { type: "array", items: { type: "string" } }, uncertainties: { type: "array", items: { type: "string" } },
      }, required: ["facts"] },
    },
    required: ["title", "task", "tier"],
  };
  const renderResult = (kind: "dispatch" | "respond" | "recover" | "wait") => (result: any, { expanded }: { expanded: boolean }) => new Text(humanizeToolResult(kind, result, expanded), 0, 0);

  pi.registerTool({
    name: "dteam_dispatch", label: "dteam dispatch", description: toolDescription,
    parameters: { type: "object", properties: { workers: { type: "array", minItems: 1, maxItems: 32, items: workerSchema } }, required: ["workers"] } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      if (!rawParams || typeof rawParams !== "object" || !Array.isArray((rawParams as any).workers)) return errorResult("workers 必须是 1–32 项数组");
      try {
        const config = runtime.config ?? loadDteamConfig(); runtime.config = config;
        const manager = managerFor(pi, runtime, ctx, config);
        const accepted = manager.dispatch((rawParams as DteamDispatchParams).workers as WorkerRequest[]);
        ctx.ui?.setStatus?.("dteam", t("status.active", { count: manager.active().length }));
        return { content: [{ type: "text" as const, text: JSON.stringify({ accepted }, null, 2) }], details: { accepted } };
      } catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
    },
    renderResult: renderResult("dispatch"),
  });

  pi.registerTool({
    name: "dteam_respond", label: "dteam respond", description: "回应 worker 的普通阻塞 request：提供上下文、授予本次预授权工具、追加一次工具额度、作出业务决策或拒绝。timeout recovery 请使用 dteam_recover。",
    parameters: { type: "object", properties: {
      workerId: { type: "string" }, requestId: { type: "string" },
      response: { type: "object", properties: { type: { type: "string", enum: ["provide_context", "grant_tools", "grant_tool_budget", "decision", "deny"] }, context: { type: "string" }, tools: { type: "array", items: { type: "string" } }, additionalCalls: { type: "number" }, decision: { type: "string" }, reason: { type: "string" } }, required: ["type"] },
    }, required: ["workerId", "requestId", "response"] } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      if (!isRespondParams(rawParams)) return errorResult("需要 workerId、requestId 和 response");
      const response = validateResponse(rawParams.response);
      if (!response.ok) return errorResult(response.error);
      try {
        const config = runtime.config ?? loadDteamConfig(); runtime.config = config;
        const result = managerFor(pi, runtime, ctx, config).respond(rawParams.workerId, rawParams.requestId, response.value);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { result } };
      } catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
    },
    renderResult: renderResult("respond"),
  });

  pi.registerTool({
    name: "dteam_recover", label: "dteam recover", description: "只回应 worker 的 timeout recovery：选择 fresh retry、相邻 escalate、有限 extend 或 stop。Worker Manager 强制 fresh session、相邻升级和恢复预算上限。",
    parameters: { type: "object", properties: {
      workerId: { type: "string" }, requestId: { type: "string" },
      action: { type: "string", enum: ["retry", "escalate", "extend", "stop"] }, tier: { type: "string", enum: ["T1", "T2", "T3"] }, additionalMs: { type: "number" }, reason: { type: "string" },
    }, required: ["workerId", "requestId", "action"] } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      const action = validateRecovery(rawParams);
      if (!action.ok) return errorResult(action.error);
      try {
        const config = runtime.config ?? loadDteamConfig(); runtime.config = config;
        const result = managerFor(pi, runtime, ctx, config).recover((rawParams as any).workerId, (rawParams as any).requestId, action.value);
        return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }], details: { result } };
      } catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
    },
    renderResult: renderResult("recover"),
  });

  pi.registerTool({
    name: "dteam_wait", label: "dteam wait", description: "仅在后续工作依赖指定 worker 时等待其下一可消费事件。任一目标 worker 完成、失败、终态或进入 waiting 时立即返回；timeout 仅结束本次等待，不取消 worker。匹配事件只通过本工具结果交付，不重复 follow-up。",
    parameters: { type: "object", properties: { workerIds: { type: "array", minItems: 1, maxItems: 32, items: { type: "string" } }, timeoutMs: { type: "integer", minimum: 1, maximum: DTEAM_CONFIG.dispatch.maxWaitMs } }, required: ["workerIds", "timeoutMs"] } as any,
    async execute(_toolCallId, rawParams, _signal, _onUpdate, ctx) {
      if (!rawParams || typeof rawParams !== "object" || !Array.isArray((rawParams as any).workerIds) || typeof (rawParams as any).timeoutMs !== "number") return errorResult("需要 workerIds 和 timeoutMs");
      try {
        const config = runtime.config ?? loadDteamConfig(); runtime.config = config;
        const result = await managerFor(pi, runtime, ctx, config).wait((rawParams as DteamWaitParams).workerIds, (rawParams as DteamWaitParams).timeoutMs);
        return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { result } };
      } catch (error) { return errorResult(error instanceof Error ? error.message : String(error)); }
    },
    renderResult: renderResult("wait"),
  });

  pi.registerCommand("dteam", {
    description: "查看、接管或取消 dteam worker",
    handler: async (_args: string, ctx: ExtensionCommandContext) => {
      const config = runtime.config ?? loadDteamConfig();
      runtime.config = config;
      if (!config.valid) { ctx.ui.notify(formatDteamConfigWarning(config), "warning"); return; }
      const manager = managerFor(pi, runtime, ctx, config);
      if (!ctx.ui?.custom) { ctx.ui.notify(renderWorkerFallback(manager.list()).join("\n"), "info"); return; }
      try {
        await ctx.ui.custom((tui, theme, _kb, done) => {
          runtime.render = () => tui.requestRender();
          let selected = 0;
          let detail = false;
          let detailOffset = 0;
          let selectedWorkerId: string | undefined;
          let view: WorkerView = "active";
          const visibleWorkers = () => workersForView(manager.list(), view);
          const selectedWorker = () => {
            const workers = visibleWorkers();
            return workers[clampSelection(selected, workers.length)];
          };
          const detailWorker = () => selectedWorkerId ? manager.get(selectedWorkerId) : undefined;
          return {
            render: (width: number) => {
              const items = manager.list();
              const worker = detail ? detailWorker() : selectedWorker();
              if (detail && worker) return renderWorkerDetail(worker, theme, width, t, detailOffset);
              return renderWorkerList(items, theme, selected, width, t, view);
            },
            invalidate: () => {},
            handleInput: (data: string) => {
              const workers = visibleWorkers();
              const worker = detail ? detailWorker() : selectedWorker();
              if (matchesKey(data, "escape") || data === "q") {
                if (detail) { detail = false; detailOffset = 0; selectedWorkerId = undefined; }
                else { done(undefined); return; }
              } else if (!detail && (matchesKey(data, "left") || data === "h")) {
                view = "active"; selected = 0;
              } else if (!detail && (matchesKey(data, "right") || data === "l")) {
                view = "history"; selected = 0;
              } else if (!detail) {
                const next = nextWorkerSelection(data, selected, workers.length);
                if (next !== null) selected = next;
                else if (data === "\r" && worker) { detail = true; detailOffset = 0; selectedWorkerId = worker.id; }
              } else if (worker) {
                const next = nextScrollOffset(data, detailOffset, detailLineCount(worker, t));
                if (next !== null) detailOffset = next;
                else if (data === "s" && ["queued", "running", "waiting"].includes(worker.state)) {
                  void ctx.ui.input(t("steering.title"), t("steering.placeholder"))
                    .then((instruction) => { if (instruction) return manager.steer(worker.id, instruction); })
                    .catch((error) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"));
                } else if (data === "c" && ["queued", "running", "waiting"].includes(worker.state)) {
                  void confirmWorkerCancellation(ctx.ui, manager, worker.id, worker.title, t)
                    .catch((error) => ctx.ui.notify(error instanceof Error ? error.message : String(error), "warning"));
                }
              }
              tui.requestRender();
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
