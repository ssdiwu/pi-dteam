import { formatDuration } from "../duration.js";
import type { DteamWaitView, DteamWaitWorkerView, WorkerReport } from "../runtime/types.js";

export type DteamToolResultKind = "dispatch" | "respond" | "recover" | "wait" | "control";

/** ADR 0019：工具 UI 只渲染摘要或人类可读详情，绝不回退到原始 JSON。 */
export function humanizeToolResult(kind: DteamToolResultKind, result: any, expanded: boolean): string {
  if (result?.isError) return humanError(result);
  if (kind === "dispatch") return dispatchText(result?.details?.accepted, expanded);
  if (kind === "wait") return result?.details?.result ? waitText(result.details.result, expanded) : waitProgressText(result?.details?.waiting);
  if (kind === "control") return controlText(result?.details, expanded);
  return actionText(kind, result?.details, expanded);
}

function dispatchText(accepted: any, expanded: boolean): string {
  const workers = Array.isArray(accepted) ? accepted : [];
  const counts = workers.reduce((all: Record<string, number>, worker: any) => ({ ...all, [worker?.tier ?? "?"]: (all[worker?.tier ?? "?"] ?? 0) + 1 }), {});
  const summary = `已受理 ${workers.length} 个 worker · ${Object.entries(counts).map(([tier, count]) => `${tier}×${count}`).join(" / ") || "无"} · queued`;
  if (!expanded) return `${summary}（Ctrl+O 展开）`;
  return [summary, ...workers.map((worker: any) => `- ${text(worker?.title) || "未命名"} · ${text(worker?.workerId) || "无 ID"} · ${text(worker?.tier) || "未知档位"} · ${text(worker?.state) || "queued"}`)].join("\n");
}

function actionText(kind: "respond" | "recover", details: any, expanded: boolean): string {
  const value = details?.result;
  const action = kind === "respond" ? "已回应 worker 请求" : "已处理超时恢复";
  const summary = `${action} · ${text(value?.state) || "已受理"}`;
  if (!expanded) return `${summary}（Ctrl+O 展开）`;
  const detail = kind === "respond" ? responseText(details?.response) : recoveryText(details?.action);
  return [summary, `- worker：${text(value?.workerId) || "无"}`, `- request：${text(value?.requestId) || "无"}`, `- ${detail}`, `- 当前状态：${text(value?.state) || "未知"}`].join("\n");
}

function controlText(details: any, expanded: boolean): string {
  const value = details?.result;
  const action = details?.action;
  const type = text(action?.action) || "未知控制";
  const summary = `已控制 worker · ${type} · ${text(value?.state) || "已受理"}`;
  if (!expanded) return `${summary}（Ctrl+O 展开）`;
  const detail = type === "steer"
    ? `纠偏：${text(action?.instruction) || "未说明"}`
    : type === "graceful_stop"
      ? `停止：优雅收敛（${text(action?.reason) || "未说明"}）`
      : `停止：强制取消（${text(action?.reason) || "未说明"}）`;
  const lines = [summary, `- worker：${text(value?.workerId) || "无"}`, `- ${detail}`, `- 当前状态：${text(value?.state) || "未知"}`];
  if (value?.cancelInitiator) lines.push(`- 取消发起方：${text(value.cancelInitiator)}`);
  if (value?.commandId && value?.deliveryState) lines.push(`- 控制命令：${text(value.commandId)} · 投递：${text(value.deliveryState)}（尚未证明 worker 已执行）`);
  if (Array.isArray(value?.supersededCommandIds) && value.supersededCommandIds.length) lines.push(`- 已取代 ${value.supersededCommandIds.length} 条排队指令`);
  if (value?.writeInterrupted) lines.push(`- 写入守卫：${arrayText(value.writeInterrupted.writeScope) || "未声明"}${value.writeInterrupted.reason ? ` · 原因：${text(value.writeInterrupted.reason)}` : ""}`);
  return lines.join("\n");
}

function responseText(response: any): string {
  const type = text(response?.type) || "未知回应";
  if (type === "provide_context") return `回应：provide_context（${text(response?.context).length} 字符上下文）`;
  if (type === "grant_tools") return `回应：grant_tools（${arrayText(response?.tools) || "无"}）`;
  if (type === "grant_tool_budget") return `回应：grant_tool_budget（+${typeof response?.additionalCalls === "number" ? response.additionalCalls : "?"} 次）`;
  if (type === "decision") return `回应：decision（${text(response?.decision) || "无内容"}）`;
  if (type === "deny") return `回应：deny（${text(response?.reason) || "未说明"}）`;
  return `回应：${type}`;
}

function recoveryText(action: any): string {
  const type = text(action?.action) || "未知恢复";
  if (type === "retry") return "恢复：retry（fresh worker）";
  if (type === "escalate") return `恢复：escalate → ${text(action?.tier) || "未知档位"}`;
  if (type === "extend") return `恢复：extend（+${typeof action?.additionalMs === "number" ? formatDuration(action.additionalMs) : "?"}）`;
  if (type === "stop") return `恢复：stop（${text(action?.reason) || "未说明"}）`;
  return `恢复：${type}`;
}

function waitProgressText(value: Pick<DteamWaitView, "targetWorkers" | "waitedMs" | "timeoutMs"> | undefined): string {
  if (!value) return "正在等待 worker…";
  return `正在等待 ${waitTargetText(value.targetWorkers)} · 已等 ${formatDuration(value.waitedMs)} / 最多 ${formatDuration(value.timeoutMs)}`;
}

function waitText(value: DteamWaitView | undefined, expanded: boolean): string {
  const ready = Array.isArray(value?.ready) ? value.ready : [];
  const pending = Array.isArray(value?.pendingWorkerIds) ? value.pendingWorkerIds : [];
  const reason = value?.reason === "timeout" ? "等待超时" : "worker 有新事件";
  const targets = waitTargetText(value?.targetWorkers);
  const timing = value ? `已等 ${formatDuration(value.waitedMs)} / 最多 ${formatDuration(value.timeoutMs)}` : "无等待数据";
  const summary = `等待 ${targets} · ${timing} · ${reason} · 本轮返回 ${ready.length} · 本轮无事件 ${pending.length}`;
  if (!expanded) return `${summary}（Ctrl+O 展开）`;
  const lines = [summary];
  for (const event of value?.events ?? []) lines.push(`- 事件 · ${text(event.workerId)} · ${text(event.type)}${parentEventDetail(event)}`);
  for (const worker of ready) lines.push(...workerLines(worker));
  for (const request of value?.requests ?? []) {
    lines.push(`- 需要回应 · ${text(request.workerId)} · ${text(request.kind)} · request ${text(request.requestId)}${request.summary ? ` · 请提供：${text(request.summary)}` : ""}`);
    lines.push(`  ${replyHint(request.workerId, request.requestId, request.kind)}`);
  }
  if (pending.length) lines.push(`- 本轮无事件：${pending.map(text).join(", ")}`);
  return lines.join("\n");
}

function parentEventDetail(event: DteamWaitView["events"][number]): string {
  if (event.findings?.length) {
    return event.findings
      .map((finding) => ` · 摘要：${text(finding.summary)} · 证据：${text(finding.evidence)} · 影响：${text(finding.impact)}`)
      .join("\n  ");
  }
  if (event.writeScope?.length) return ` · 写入范围：${arrayText(event.writeScope) || "无"}${event.reason ? ` · 原因：${text(event.reason)}` : ""}`;
  if (event.reason) return ` · 原因：${text(event.reason)}`;
  if (event.error) return ` · 错误：${text(event.error)}`;
  return "";
}

function replyHint(workerId: string, requestId: string, kind: string): string {
  const field = kind === "request_context"
    ? "context"
    : kind === "request_tools"
      ? "tools"
      : kind === "request_tool_budget"
        ? "additionalCalls"
        : kind === "request_decision" || kind === "blocked"
          ? "decision"
          : undefined;
  if (!field) return `恢复提示：dteam_recover · workerId=${text(workerId)} · requestId=${text(requestId)} · action=retry | escalate | extend | stop`;
  const type = kind === "request_context"
    ? "provide_context"
    : kind === "request_tools"
      ? "grant_tools"
      : kind === "request_tool_budget"
        ? "grant_tool_budget"
        : "decision";
  return `回应提示：dteam_respond · workerId=${text(workerId)} · requestId=${text(requestId)} · response.type=${type} · ${field}=…`;
}

function waitTargetText(targets: DteamWaitView["targetWorkers"] | undefined): string {
  if (!targets?.length) return "未知 worker";
  return targets.map((worker) => `${text(worker.title) || "未命名"} (${text(worker.id) || "无 ID"})`).join("、");
}

function workerLines(worker: DteamWaitWorkerView): string[] {
  const lines = [`- ${text(worker.title) || "未命名"} · ${text(worker.id)} · ${text(worker.state)}`];
  if (worker.writeScope?.length) lines.push(`  本 worker 写入范围：${arrayText(worker.writeScope)}（不代表父任务完成）`);
  if (worker.report) lines.push(...reportLines(worker.report));
  if (worker.error) lines.push(`  错误：${text(worker.error)}`);
  if (worker.timeoutDiagnostic) lines.push(`  超时：${text(worker.timeoutDiagnostic.lastActivity) || "无活动信息"}`);
  return lines;
}

function reportLines(report: WorkerReport): string[] {
  const lines = [
    `  报告：${report.outcome} · ${text(report.summary)}`,
    `  动作：${arrayText(report.activities)}`,
    `  验证：${report.verification.depth} / ${report.verification.status}`,
  ];
  for (const evidence of report.verification.evidence) lines.push(`    证据：${text(evidence)}`);
  for (const remaining of report.verification.remaining ?? []) lines.push(`    剩余：${text(remaining)}`);
  for (const fact of report.facts) lines.push(`  事实：${text(fact.claim)} ← ${text(fact.evidence)}`);
  for (const uncertainty of report.uncertainties ?? []) lines.push(`  不确定：${text(uncertainty)}`);
  return lines;
}

function humanError(result: any): string {
  const raw = result?.content?.find?.((item: any) => item?.type === "text")?.text;
  return text(raw) || "dteam 操作失败";
}

function arrayText(value: unknown): string {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string").map(text).filter(Boolean).join("、") : "";
}

function text(value: unknown): string {
  return typeof value === "string"
    ? value.replace(/[\r\n]+/g, " ").replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "�").trim()
    : "";
}
