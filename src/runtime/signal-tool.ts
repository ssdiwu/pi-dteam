import type { WorkerSignal } from "./types.js";

export interface SignalToolHost {
  receiveSignal(workerId: string, signal: WorkerSignal): Promise<unknown>;
}

/** 每个 worker 独享的 signal 工具；它不暴露给主代理。 */
export function makeSignalTool(workerId: string, host: SignalToolHost): any {
  return {
    name: "dteam_signal",
    label: "dteam signal",
    description: "向 dteam 主代理报告进度、发现或请求上下文、工具和决策。",
    parameters: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["progress", "finding", "request_context", "request_tools", "request_decision", "blocked"] },
        message: { type: "string" },
        percent: { type: "number" },
        summary: { type: "string" },
        evidence: { type: "string" },
        requestId: { type: "string" },
        question: { type: "string" },
        contextNeeded: { type: "string" },
        tools: { type: "array", items: { type: "string" } },
        reason: { type: "string" },
        candidates: { type: "array", items: { type: "string" } },
        recommendation: { type: "string" },
        action: { type: "string" },
      },
      required: ["kind"],
    },
    async execute(_toolCallId: string, params: unknown) {
      const result = await host.receiveSignal(workerId, parseSignal(params));
      return {
        content: [{ type: "text" as const, text: JSON.stringify(result) }],
        details: { signal: result },
      };
    },
  };
}

function parseSignal(raw: unknown): WorkerSignal {
  if (!raw || typeof raw !== "object" || typeof (raw as any).kind !== "string") throw new Error("dteam_signal: kind 必须存在");
  const value = raw as Record<string, unknown>;
  const kind = value.kind as string;
  if (kind === "progress") {
    if (typeof value.message !== "string") throw new Error("dteam_signal: progress.message 必须是字符串");
    return { kind, message: value.message, ...(typeof value.percent === "number" ? { percent: value.percent } : {}) };
  }
  if (kind === "finding") {
    if (typeof value.summary !== "string") throw new Error("dteam_signal: finding.summary 必须是字符串");
    return { kind, summary: value.summary, ...(typeof value.evidence === "string" ? { evidence: value.evidence } : {}) };
  }
  if (["request_context", "request_tools", "request_decision", "blocked"].includes(kind)) {
    if (typeof value.requestId !== "string" || !value.requestId) throw new Error(`dteam_signal: ${kind}.requestId 必须存在`);
    if (kind === "request_context" && typeof value.question === "string") return { kind, requestId: value.requestId, question: value.question, ...(typeof value.contextNeeded === "string" ? { contextNeeded: value.contextNeeded } : {}) };
    if (kind === "request_tools" && Array.isArray(value.tools) && value.tools.every((tool) => typeof tool === "string") && typeof value.reason === "string") return { kind, requestId: value.requestId, tools: value.tools, reason: value.reason };
    if (kind === "request_decision" && typeof value.question === "string") return { kind, requestId: value.requestId, question: value.question, ...(Array.isArray(value.candidates) ? { candidates: value.candidates.filter((item): item is string => typeof item === "string") } : {}), ...(typeof value.recommendation === "string" ? { recommendation: value.recommendation } : {}) };
    if (kind === "blocked" && typeof value.reason === "string") return { kind, requestId: value.requestId, reason: value.reason, ...(typeof value.action === "string" ? { action: value.action } : {}) };
  }
  throw new Error(`dteam_signal: 非法 signal ${kind}`);
}
