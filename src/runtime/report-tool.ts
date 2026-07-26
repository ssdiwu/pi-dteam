import {
  REPORT_OUTCOMES,
  REPORT_TOOL_NAME,
  VERIFICATION_DEPTHS,
  VERIFICATION_STATUSES,
  WORKER_ACTIVITIES,
  type VerificationDepth,
  type WorkerActivity,
  type WorkerReport,
} from "./types.js";

export interface ReportToolHost {
  receiveReport(workerId: string, report: unknown, candidateId?: string): unknown;
}

export function makeReportSchema(): Record<string, unknown> {
  return {
    type: "object",
    additionalProperties: false,
    properties: {
      outcome: { type: "string", enum: [...REPORT_OUTCOMES] },
      summary: { type: "string", minLength: 1 },
      activities: { type: "array", minItems: 1, items: { type: "string", enum: [...WORKER_ACTIVITIES] } },
      facts: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          additionalProperties: false,
          properties: { claim: { type: "string", minLength: 1 }, evidence: { type: "string", minLength: 1 } },
          required: ["claim", "evidence"],
        },
      },
      verification: {
        type: "object",
        additionalProperties: false,
        properties: {
          depth: { type: "string", enum: [...VERIFICATION_DEPTHS] },
          status: { type: "string", enum: [...VERIFICATION_STATUSES] },
          evidence: { type: "array", items: { type: "string", minLength: 1 } },
          remaining: { type: "array", items: { type: "string", minLength: 1 } },
        },
        required: ["depth", "status", "evidence", "remaining"],
      },
      uncertainties: { type: "array", items: { type: "string", minLength: 1 } },
    },
    required: ["outcome", "summary", "activities", "facts", "verification", "uncertainties"],
  };
}

/** 每个 worker 结束前必须调用的内部结构化报告工具。 */
export function makeReportTool(workerId: string, candidateId: string, host: ReportToolHost): any {
  return {
    name: REPORT_TOOL_NAME,
    label: "dteam report",
    description: "提交最终结构化工作报告。完成前必须恰好调用一次；区分任务 outcome、实际 activities 与实际 verification，只报告可核验事实。",
    parameters: makeReportSchema(),
    // 受约束采样：支持的模型按 strict JSON Schema 调用，不支持的模型自动降级为普通工具调用，
    // 不影响多供应商回退；parseWorkerReport 仍负责跨字段语义校验。
    constrainedSampling: { type: "json_schema", strict: "prefer" } as any,
    async execute(_toolCallId: string, params: unknown) {
      const result = await host.receiveReport(workerId, params, candidateId);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { report: result } };
    },
  };
}

export function parseWorkerReport(raw: unknown): WorkerReport {
  const value = asRecord(raw, "参数");
  assertAllowedKeys(value, ["outcome", "summary", "activities", "facts", "verification", "uncertainties"], "报告");

  const outcome = parseEnum(value.outcome, REPORT_OUTCOMES, "outcome");
  const summary = parseNonEmptyString(value.summary, "summary");
  const activities = parseActivities(value.activities);
  const facts = parseFacts(value.facts);
  const verification = parseVerification(value.verification, activities);
  const uncertainties = value.uncertainties === undefined ? undefined : parseStringArray(value.uncertainties, "uncertainties");

  return {
    outcome,
    summary,
    activities,
    facts,
    verification,
    ...(uncertainties !== undefined ? { uncertainties } : {}),
  };
}

function parseActivities(raw: unknown): WorkerActivity[] {
  const values = parseStringArray(raw, "activities", 1);
  if (new Set(values).size !== values.length) throw new Error("dteam_report: activities 不可重复");
  return values.map((value) => parseEnum(value, WORKER_ACTIVITIES, "activities"));
}

function parseFacts(raw: unknown): WorkerReport["facts"] {
  if (!Array.isArray(raw) || raw.length < 1) throw new Error("dteam_report: facts 必须是非空数组");
  return raw.map((item) => {
    const fact = asRecord(item, "facts 项");
    assertAllowedKeys(fact, ["claim", "evidence"], "facts 项");
    return { claim: parseNonEmptyString(fact.claim, "facts.claim"), evidence: parseNonEmptyString(fact.evidence, "facts.evidence") };
  });
}

function parseVerification(raw: unknown, activities: WorkerActivity[]): WorkerReport["verification"] {
  const value = asRecord(raw, "verification");
  assertAllowedKeys(value, ["depth", "status", "evidence", "remaining"], "verification");
  const depth = parseEnum(value.depth, VERIFICATION_DEPTHS, "verification.depth");
  const status = parseEnum(value.status, VERIFICATION_STATUSES, "verification.status");
  const evidence = parseStringArray(value.evidence, "verification.evidence");
  const remaining = value.remaining === undefined ? undefined : parseStringArray(value.remaining, "verification.remaining");

  if (depth === "none") {
    if (status !== "not_run" || evidence.length > 0) throw new Error("dteam_report: depth=none 时必须 status=not_run 且 evidence 为空");
  } else if (status === "not_run" || evidence.length < 1) {
    throw new Error("dteam_report: 已执行验证时 status 不可为 not_run，且 evidence 至少一项");
  }
  assertActivitiesForDepth(depth, activities);

  return { depth, status, evidence, ...(remaining !== undefined ? { remaining } : {}) };
}

function assertActivitiesForDepth(depth: VerificationDepth, activities: WorkerActivity[]): void {
  const required: Partial<Record<VerificationDepth, WorkerActivity[]>> = {
    inspection: ["inspected"],
    automated: ["tested"],
    runtime: ["executed"],
    visual: ["executed", "captured_visual"],
  };
  const missing = required[depth]?.filter((activity) => !activities.includes(activity)) ?? [];
  if (missing.length > 0) throw new Error(`dteam_report: verification.depth=${depth} 要求 activities 包含 ${missing.join("、")}`);
}

function parseStringArray(raw: unknown, field: string, minItems = 0): string[] {
  if (!Array.isArray(raw) || raw.length < minItems) throw new Error(`dteam_report: ${field} 必须是${minItems > 0 ? "非空" : ""}数组`);
  return raw.map((item) => parseNonEmptyString(item, field));
}

function parseNonEmptyString(raw: unknown, field: string): string {
  if (typeof raw !== "string" || !raw.trim()) throw new Error(`dteam_report: ${field} 必须是非空字符串`);
  return raw;
}

function parseEnum<const T extends readonly string[]>(raw: unknown, values: T, field: string): T[number] {
  if (typeof raw !== "string" || !values.includes(raw)) throw new Error(`dteam_report: ${field} 必须是 ${values.join("、")} 之一`);
  return raw as T[number];
}

function asRecord(raw: unknown, field: string): Record<string, unknown> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error(`dteam_report: ${field} 必须是对象`);
  return raw as Record<string, unknown>;
}

function assertAllowedKeys(value: Record<string, unknown>, allowed: string[], field: string): void {
  const extras = Object.keys(value).filter((key) => !allowed.includes(key));
  if (extras.length > 0) throw new Error(`dteam_report: ${field} 包含未知字段 ${extras.join("、")}`);
}
