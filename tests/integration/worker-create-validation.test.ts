import { describe, it, expect } from "vitest";
import {
  workerCreate,
  workerStart,
  workerGetMemory,
} from "../../src/P2/worker.js";

describe("Worker Create 参数校验", () => {
  const ctx = { cwd: process.cwd() };

  it("缺少 config 时返回结构化错误", async () => {
    // @ts-expect-error 故意缺少参数
    const result = await workerCreate(ctx, {});
    const parsed = JSON.parse(result.content);

    expect(parsed.status).toBe("failed");
    expect(parsed.error).toContain("config");
  });

  it("缺少 task 字段时返回结构化错误", async () => {
    const result = await workerCreate(ctx, {
      // @ts-expect-error 故意缺 task
      config: { type: "solo", style: "explore", options: [] },
    });
    const parsed = JSON.parse(result.content);

    expect(parsed.status).toBe("failed");
    expect(parsed.error).toContain("type/task/style");
  });

  it("缺 config 失败时 worker_start 在共享内存写入诊断键", async () => {
    const workerId = `worker-validate-${Date.now()}`;
    // @ts-expect-error 故意传空 config
    const createResult = await workerCreate(ctx, {});
    expect(JSON.parse(createResult.content).status).toBe("failed");

    // 模拟 worker_start 找不到 worker（因为 create 没成功）
    const startResult = await workerStart(ctx, { workerId });
    const startParsed = JSON.parse(startResult.content);
    expect(startParsed.status).toBe("failed");

    const mem = await workerGetMemory(ctx, { namespace: `worker-${workerId}` });
    const memParsed = JSON.parse(mem.content);
    expect(memParsed.values.status).toBe("failed");
    expect(memParsed.values.lastPhase).toBe("worker_start");
  });
});
