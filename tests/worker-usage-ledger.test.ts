import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, readFileSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { appendUsageLedger, createUsageLedgerEntry, sanitizeUsage, usageDedupKey, usageLedgerPath } from "../src/runtime/usage-ledger.js";

const root = join(tmpdir(), `pi-dteam-usage-ledger-${process.pid}`);

afterEach(() => { rmSync(root, { recursive: true, force: true }); });

describe("dteam usage ledger", () => {
  it("只保留脱敏后的数字 usage 白名单", () => {
    const usage = sanitizeUsage({
      input: 10,
      output: 20,
      cacheRead: 3,
      cacheWrite: 4,
      totalTokens: 37,
      cost: { input: 0.1, output: 0.2, total: 0.3, secret: "sk-not-a-number" },
      prompt: "password=hunter2",
      raw: { token: "sk-12345678901234567890" },
    });

    expect(usage).toEqual({ input: 10, output: 20, cacheRead: 3, cacheWrite: 4, totalTokens: 37, cost: { input: 0.1, output: 0.2, total: 0.3 } });
    expect(JSON.stringify(usage)).not.toContain("hunter2");
    expect(JSON.stringify(usage)).not.toContain("sk-");
  });

  it("为相同脱敏内容生成稳定 SHA-256 去重键", () => {
    const first = createUsageLedgerEntry({
      timestamp: "2026-01-01T00:00:00.000Z",
      parentSessionId: "parent",
      project: "/workspace/project",
      workerId: "worker",
      requestedTier: "T2",
      activeTier: "T2",
      candidateId: "candidate",
      model: "provider/model",
      usage: { input: 1, output: 2, totalTokens: 3, ignored: "secret" },
    });
    const second = createUsageLedgerEntry({
      timestamp: "2026-01-01T00:00:00.000Z",
      parentSessionId: "parent",
      project: "/workspace/project",
      workerId: "worker",
      requestedTier: "T2",
      activeTier: "T2",
      candidateId: "candidate",
      model: "provider/model",
      usage: { totalTokens: 3, output: 2, input: 1, ignored: "different" },
    });

    expect(first.dedupKey).toBe(second.dedupKey);
    expect(first.dedupKey).toMatch(/^[a-f0-9]{64}$/);
    expect(usageDedupKey({ ...first, timestamp: "2026-01-02T00:00:00.000Z" })).not.toBe(first.dedupKey);
  });

  it("按 JSONL 追加写入，并以 0600 创建 ledger 文件", async () => {
    const agentDir = join(root, "nested", "agent");
    await appendUsageLedger(agentDir, {
      parentSessionId: "parent",
      project: "/workspace/project",
      workerId: "worker-1",
      requestedTier: "T2",
      activeTier: "T1",
      candidateId: "candidate-1",
      model: "provider/model",
      usage: { input: 4, output: 5, totalTokens: 9, raw: "password=hunter2" },
    });
    chmodSync(usageLedgerPath(agentDir), 0o644);
    await appendUsageLedger(agentDir, {
      parentSessionId: "parent",
      project: "/workspace/project",
      workerId: "worker-2",
      requestedTier: "T2",
      activeTier: "T2",
      candidateId: "candidate-2",
      model: "provider/model",
      usage: { input: 1, output: 1, totalTokens: 2 },
    });

    const path = usageLedgerPath(agentDir);
    const lines = readFileSync(path, "utf8").trimEnd().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]!)).toMatchObject({ workerId: "worker-1", usage: { input: 4, output: 5, totalTokens: 9 } });
    expect(JSON.stringify(JSON.parse(lines[0]!))).not.toContain("hunter2");
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });
});
