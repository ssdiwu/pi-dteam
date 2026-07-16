import type { WorkerReport } from "./types.js";

export interface ReportToolHost {
  receiveReport(workerId: string, report: WorkerReport): unknown;
}

/** 每个 worker 结束前必须调用的内部结构化报告工具。 */
export function makeReportTool(workerId: string, host: ReportToolHost): any {
  return {
    name: "dteam_report",
    label: "dteam report",
    description: "提交最终结构化工作报告。完成前必须恰好调用一次；只报告可核验事实，不要使用自由文本作为交接替代。",
    parameters: {
      type: "object",
      properties: {
        summary: { type: "string" },
        facts: {
          type: "array",
          items: {
            type: "object",
            properties: { claim: { type: "string" }, evidence: { type: "string" } },
            required: ["claim", "evidence"],
          },
        },
        uncertainties: { type: "array", items: { type: "string" } },
      },
      required: ["summary", "facts"],
    },
    async execute(_toolCallId: string, params: unknown) {
      const report = parseReport(params);
      const result = await host.receiveReport(workerId, report);
      return { content: [{ type: "text" as const, text: JSON.stringify(result) }], details: { report: result } };
    },
  };
}

function parseReport(raw: unknown): WorkerReport {
  if (!raw || typeof raw !== "object") throw new Error("dteam_report: 参数必须是对象");
  const value = raw as Record<string, unknown>;
  if (typeof value.summary !== "string" || !value.summary.trim()) throw new Error("dteam_report: summary 必须是非空字符串");
  if (!Array.isArray(value.facts)) throw new Error("dteam_report: facts 必须是数组");
  const facts = value.facts.map((fact) => {
    if (!fact || typeof fact !== "object" || typeof (fact as any).claim !== "string" || typeof (fact as any).evidence !== "string" || !(fact as any).claim.trim() || !(fact as any).evidence.trim()) {
      throw new Error("dteam_report: 每项 facts 必须有非空 claim 和 evidence");
    }
    return { claim: (fact as any).claim, evidence: (fact as any).evidence };
  });
  if (value.uncertainties !== undefined && (!Array.isArray(value.uncertainties) || !value.uncertainties.every((item) => typeof item === "string" && item.trim()))) {
    throw new Error("dteam_report: uncertainties 必须是非空字符串数组");
  }
  return { summary: value.summary, facts, ...(value.uncertainties ? { uncertainties: value.uncertainties as string[] } : {}) };
}
