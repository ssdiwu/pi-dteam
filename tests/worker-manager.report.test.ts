import { describe, expect, it , mock } from "bun:test";
import { makeReportSchema, makeReportTool, parseWorkerReport } from "../src/runtime/report-tool.js";
import { workerReport } from "./worker-report.fixture.js";

describe("WorkerReport contract", () => {
  it("schema 固定统一字段与枚举，不接受额外字段", () => {
    const schema = makeReportSchema() as any;
    expect(schema).toMatchObject({
      type: "object",
      additionalProperties: false,
      required: ["outcome", "summary", "activities", "facts", "verification", "uncertainties"],
      properties: {
        outcome: { enum: ["completed", "partial"] },
        activities: { minItems: 1 },
        verification: { additionalProperties: false, required: ["depth", "status", "evidence", "remaining"] },
      },
    });
  });

  it("strict provider schema omits unsupported constraints while parser preserves semantics", () => {
    const schema = makeReportSchema() as any;
    expect(schema.properties.activities).not.toHaveProperty("uniqueItems");
    expect(schema.properties.verification).not.toHaveProperty("oneOf");
    expect(() => parseWorkerReport(workerReport({ activities: ["inspected", "inspected"] }))).toThrow("dteam_report");
  });

  it("strict Schema 关闭额外字段并要求每个 properties 键", () => {
    const missingRequired: string[] = [];
    const missingAdditionalProperties: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (!value || typeof value !== "object") return;
      const schema = value as Record<string, unknown>;
      if (schema.type === "object" && schema.additionalProperties !== false) missingAdditionalProperties.push(path);
      if (schema.properties && typeof schema.properties === "object" && !Array.isArray(schema.properties)) {
        const required = new Set(Array.isArray(schema.required) ? schema.required.filter((key): key is string => typeof key === "string") : []);
        for (const key of Object.keys(schema.properties as Record<string, unknown>)) if (!required.has(key)) missingRequired.push(`${path}.properties.${key}`);
      }
      for (const [key, child] of Object.entries(schema)) {
        if (Array.isArray(child)) child.forEach((item, index) => visit(item, `${path}.${key}[${index}]`));
        else visit(child, `${path}.${key}`);
      }
    };

    visit(makeReportSchema(), "dteam_report");
    expect(missingAdditionalProperties).toEqual([]);
    expect(missingRequired).toEqual([]);
    expect(makeReportTool("worker-1", "candidate-1", { receiveReport: mock() }).constrainedSampling).toEqual({ type: "json_schema", strict: "prefer" });
  });

  it("接受 partial outcome 与诚实的 none + not_run", () => {
    const report = parseWorkerReport(workerReport({
      outcome: "partial",
      summary: "完成静态读取，未运行验证",
      verification: { depth: "none", status: "not_run", evidence: [], remaining: ["缺少运行环境"] },
      uncertainties: ["真实 provider 行为未知"],
    }));
    expect(report).toMatchObject({
      outcome: "partial",
      activities: ["inspected"],
      verification: { depth: "none", status: "not_run", evidence: [], remaining: ["缺少运行环境"] },
    });
  });

  it.each<[string, unknown]>([
    ["旧报告形状", { summary: "完成", facts: [{ claim: "事实", evidence: "证据" }] }],
    ["human 字段", { ...workerReport(), human: "passed" }],
    ["期望深度字段", { ...workerReport(), expectedVerificationDepth: "runtime" }],
    ["重复 activity", workerReport({ activities: ["inspected", "inspected"] })],
    ["空 facts", workerReport({ facts: [] })],
    ["none 与 passed 冲突", workerReport({ verification: { depth: "none", status: "passed", evidence: [] } })],
    ["自动验证却未 tested", workerReport({ verification: { depth: "automated", status: "passed", evidence: ["npm test"] } })],
    ["visual 缺少 executed", workerReport({ activities: ["captured_visual"], verification: { depth: "visual", status: "passed", evidence: ["screenshot.png"] } })],
    ["已验证但没有 evidence", workerReport({ verification: { depth: "inspection", status: "passed", evidence: [] } })],
    ["未知 outcome", { ...workerReport(), outcome: "inconclusive" }],
  ])("拒绝%s", (_name, raw) => {
    expect(() => parseWorkerReport(raw)).toThrow("dteam_report");
  });

  it("visual 深度要求 executed + captured_visual，允许 status=partial", () => {
    const report = parseWorkerReport(workerReport({
      activities: ["inspected", "executed", "captured_visual"],
      verification: { depth: "visual", status: "partial", evidence: ["artifacts/screenshot.png"], remaining: ["暗色模式未检查"] },
    }));
    expect(report.verification).toEqual({ depth: "visual", status: "partial", evidence: ["artifacts/screenshot.png"], remaining: ["暗色模式未检查"] });
  });

  it("内部工具把原始参数交给 Manager 校验边界", async () => {
    const receiveReport = mock(() => ({ ok: true }));
    const tool = makeReportTool("worker-1", "candidate-1", { receiveReport });
    const report = workerReport({ activities: ["tested"], verification: { depth: "automated", status: "passed", evidence: ["npm test: passed"] } });
    await expect(tool.execute("call", report)).resolves.toMatchObject({ details: { report: { ok: true } } });
    expect(receiveReport).toHaveBeenCalledWith("worker-1", report, "candidate-1");
  });
});
