import { DTEAM_CONFIG } from "../config.js";
import type { WorkerSignal } from "./types.js";

const MAX_FINDING_FIELD_CHARS = DTEAM_CONFIG.dispatch.maxHandoffFieldChars;
const SIGNAL_FIELDS_BY_KIND: Record<string, ReadonlySet<string>> = {
  progress: new Set(["kind", "message", "percent"]),
  finding: new Set(["kind", "summary", "evidence", "impact"]),
  request_context: new Set(["kind", "requestId", "question", "contextNeeded"]),
  request_tools: new Set(["kind", "requestId", "tools", "reason"]),
  request_tool_budget: new Set(["kind", "requestId", "reason"]),
  request_decision: new Set(["kind", "requestId", "question", "candidates", "recommendation"]),
  blocked: new Set(["kind", "requestId", "reason", "action"]),
};

export interface SignalToolHost {
  receiveSignal(workerId: string, signal: WorkerSignal, candidateId: string): Promise<unknown>;
}

/** 每个 worker candidate 独享的 signal 工具；它不暴露给主代理。 */
export function makeSignalTool(workerId: string, candidateId: string, host: SignalToolHost): any {
  return {
    name: "dteam_signal",
    label: "dteam signal",
    description: "向 dteam 主代理报告普通进度、带证据和路由影响的可行动发现，或请求上下文、工具、工具调用额度和决策。",
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: {
        kind: { type: "string", enum: ["progress", "finding", "request_context", "request_tools", "request_tool_budget", "request_decision", "blocked"] },
        message: { type: "string" },
        percent: { type: "number" },
        summary: { type: "string", minLength: 1, maxLength: MAX_FINDING_FIELD_CHARS },
        evidence: { type: "string", minLength: 1, maxLength: MAX_FINDING_FIELD_CHARS },
        impact: { type: "string", minLength: 1, maxLength: MAX_FINDING_FIELD_CHARS },
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
      const result = await host.receiveSignal(workerId, parseSignal(params), candidateId);
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
  const allowedFields = SIGNAL_FIELDS_BY_KIND[kind];
  if (!allowedFields) throw new Error(`dteam_signal: 非法 signal ${kind}`);
  const unknownField = Object.keys(value).find((key) => !allowedFields.has(key));
  if (unknownField) throw new Error(`dteam_signal: ${kind} 不允许字段 ${unknownField}`);
  if (kind === "progress") {
    if (typeof value.message !== "string") throw new Error("dteam_signal: progress.message 必须是字符串");
    return { kind, message: value.message, ...(typeof value.percent === "number" ? { percent: value.percent } : {}) };
  }
  if (kind === "finding") {
    const summary = requiredText(value.summary, "summary");
    const evidence = requiredText(value.evidence, "evidence");
    const impact = requiredText(value.impact, "impact");
    return { kind, summary, evidence, impact };
  }
  if (["request_context", "request_tools", "request_tool_budget", "request_decision", "blocked"].includes(kind)) {
    if (typeof value.requestId !== "string" || !value.requestId) throw new Error(`dteam_signal: ${kind}.requestId 必须存在`);
    if (kind === "request_context" && typeof value.question === "string") return { kind, requestId: value.requestId, question: value.question, ...(typeof value.contextNeeded === "string" ? { contextNeeded: value.contextNeeded } : {}) };
    if (kind === "request_tools" && Array.isArray(value.tools) && value.tools.every((tool) => typeof tool === "string") && typeof value.reason === "string") return { kind, requestId: value.requestId, tools: value.tools, reason: value.reason };
    if (kind === "request_tool_budget" && typeof value.reason === "string") return { kind, requestId: value.requestId, reason: value.reason };
    if (kind === "request_decision" && typeof value.question === "string") return { kind, requestId: value.requestId, question: value.question, ...(Array.isArray(value.candidates) ? { candidates: value.candidates.filter((item): item is string => typeof item === "string") } : {}), ...(typeof value.recommendation === "string" ? { recommendation: value.recommendation } : {}) };
    if (kind === "blocked" && typeof value.reason === "string") return { kind, requestId: value.requestId, reason: value.reason, ...(typeof value.action === "string" ? { action: value.action } : {}) };
  }
  throw new Error(`dteam_signal: 非法 signal ${kind}`);
}

function requiredText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`dteam_signal: finding.${field} 必须是非空字符串`);
  if (value.length > MAX_FINDING_FIELD_CHARS) throw new Error(`dteam_signal: finding.${field} 超过 ${MAX_FINDING_FIELD_CHARS} 字符上限`);
  return value;
}
