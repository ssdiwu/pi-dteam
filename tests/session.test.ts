import { mockCreateAgentSession, mockDiscoverAndLoadExtensions, mockSessionManager } from "./mock-modules.js";
import { beforeEach, describe, expect, it, mock } from "bun:test";

const { createWorkerSession } = await import("../src/session.js?session-test");

describe("createWorkerSession", () => {
  beforeEach(() => {
    mockDiscoverAndLoadExtensions.mockClear();
    mockSessionManager.mockClear();
    mockSessionManager.mockReturnValue({ kind: "in-memory" });
  });

  it("按 T3 默认创建逻辑隔离的 fresh session", async () => {
    const model = { provider: "provider", id: "fast" };
    const worker = await createWorkerSession({
      tier: "T3",
      cwd: "/workspace",
      modelStr: "provider/fast",
      ctx: { modelRegistry: { find: mock(() => model), authStorage: {} } },
      logicalIsolation: true,
    });

    expect(worker).toEqual({ id: "fresh-worker" });
    expect(mockDiscoverAndLoadExtensions).not.toHaveBeenCalled();
    expect(mockCreateAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      model,
      thinkingLevel: "low",
      tools: ["read", "grep", "find", "ls"],
      sessionManager: { kind: "in-memory" },
    }));
  });
});
