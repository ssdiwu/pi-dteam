import { describe, it, expect } from "vitest";
import {
  workerStart,
  workerGetMemory,
} from "../../src/P2/worker.js";

describe("Worker 内存诊断最小集", () => {
  const ctx = { cwd: process.cwd() };

  it("worker_start 找不到 worker 时，应在共享内存中写入诊断键", async () => {
    const workerId = `worker-not-exist-${Date.now()}`;
    const result = await workerStart(ctx, { workerId });
    const parsed = JSON.parse(result.content);

    expect(parsed.status).toBe("failed");
    expect(parsed.error).toContain("Worker not found");

    const mem = await workerGetMemory(ctx, { namespace: `worker-${workerId}` });
    const memParsed = JSON.parse(mem.content);

    expect(memParsed.keys).toContain("status");
    expect(memParsed.keys).toContain("lastPhase");
    expect(memParsed.keys).toContain("lastError");
    expect(memParsed.values.status).toBe("failed");
    expect(memParsed.values.lastPhase).toBe("worker_start");
    expect(memParsed.values.lastError).toContain("Worker not found");
  });
});
