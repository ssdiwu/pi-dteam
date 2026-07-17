import type { WorkerReport, WorkerVerification } from "../src/runtime/types.js";

type WorkerReportOverrides = Omit<Partial<WorkerReport>, "verification"> & {
  verification?: Partial<WorkerVerification>;
};

export function workerReport(overrides: WorkerReportOverrides = {}): WorkerReport {
  const verification: WorkerVerification = {
    depth: "inspection",
    status: "passed",
    evidence: ["test fixture inspection"],
    ...overrides.verification,
  };
  return {
    outcome: "completed",
    summary: "完成",
    activities: ["inspected"],
    facts: [{ claim: "任务已处理", evidence: "test fixture" }],
    ...overrides,
    verification,
  };
}
