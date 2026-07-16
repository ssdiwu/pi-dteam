import type { DteamWaitResult, WorkerSnapshot } from "../runtime/types.js";

export type DteamToolResultKind = "dispatch" | "respond" | "recover" | "wait";

/** ADR 0019：工具 UI 只渲染摘要或人类可读详情，绝不回退到原始 JSON。 */
export function humanizeToolResult(kind: DteamToolResultKind, result: any, expanded: boolean): string {
  if (result?.isError) return humanError(result);
  if (kind === "dispatch") return dispatchText(result?.details?.accepted, expanded);
  if (kind === "wait") return waitText(result?.details?.result, expanded);
  return actionText(kind, result?.details?.result, expanded);
}

function dispatchText(accepted: any, expanded: boolean): string {
  const workers = Array.isArray(accepted) ? accepted : [];
  const counts = workers.reduce((all: Record<string, number>, worker: any) => ({ ...all, [worker?.tier ?? "?"]: (all[worker?.tier ?? "?"] ?? 0) + 1 }), {});
  const summary = `已受理 ${workers.length} 个 worker · ${Object.entries(counts).map(([tier, count]) => `${tier}×${count}`).join(" / ") || "无"} · queued`;
  if (!expanded) return `${summary}（Ctrl+O 展开）`;
  return [summary, ...workers.map((worker: any) => `- ${text(worker?.title) || "未命名"} · ${text(worker?.workerId) || "无 ID"} · ${text(worker?.tier) || "未知档位"} · ${text(worker?.state) || "queued"}`)].join("\n");
}

function actionText(kind: "respond" | "recover", value: any, expanded: boolean): string {
  const action = kind === "respond" ? "已回应 worker 请求" : "已处理超时恢复";
  const summary = `${action} · ${text(value?.state) || "已受理"}`;
  if (!expanded) return `${summary}（Ctrl+O 展开）`;
  return [summary, `- worker：${text(value?.workerId) || "无"}`, `- request：${text(value?.requestId) || "无"}`, `- 当前状态：${text(value?.state) || "未知"}`].join("\n");
}

function waitText(value: DteamWaitResult | undefined, expanded: boolean): string {
  const ready = Array.isArray(value?.ready) ? value.ready : [];
  const pending = Array.isArray(value?.pendingWorkerIds) ? value.pendingWorkerIds : [];
  const reason = value?.reason === "timeout" ? "等待超时" : "worker 有新事件";
  const summary = `${reason} · 已就绪 ${ready.length} · 仍等待 ${pending.length}`;
  if (!expanded) return `${summary}（Ctrl+O 展开）`;
  const lines = [summary];
  for (const worker of ready) lines.push(...workerLines(worker));
  for (const request of value?.requests ?? []) lines.push(`- 需要回应 · ${text(request.workerId)} · ${text(request.kind)} · request ${text(request.requestId)}`);
  if (pending.length) lines.push(`- 仍等待：${pending.map(text).join(", ")}`);
  return lines.join("\n");
}

function workerLines(worker: WorkerSnapshot): string[] {
  const lines = [`- ${text(worker.title) || "未命名"} · ${text(worker.id)} · ${text(worker.state)}`];
  if (worker.report?.summary) lines.push(`  报告：${text(worker.report.summary)}`);
  if (worker.error) lines.push(`  错误：${text(worker.error)}`);
  if (worker.timeoutDiagnostic) lines.push(`  超时：${text(worker.timeoutDiagnostic.lastActivity) || "无活动信息"}`);
  return lines;
}

function humanError(result: any): string {
  const raw = result?.content?.find?.((item: any) => item?.type === "text")?.text;
  return text(raw) || "dteam 操作失败";
}

function text(value: unknown): string {
  return typeof value === "string" ? value.replace(/[\r\n]+/g, " ").trim() : "";
}
