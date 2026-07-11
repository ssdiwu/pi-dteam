import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  mockCreateAgentSession,
  mockDiscoverAndLoadExtensions,
  mockSessionManager,
} = vi.hoisted(() => ({
  mockCreateAgentSession: vi.fn(),
  mockDiscoverAndLoadExtensions: vi.fn(),
  mockSessionManager: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createExtensionRuntime: vi.fn(() => ({})),
  discoverAndLoadExtensions: mockDiscoverAndLoadExtensions,
  SessionManager: { inMemory: mockSessionManager },
  SettingsManager: { inMemory: vi.fn(() => ({})) },
}));

vi.mock("@earendil-works/pi-ai", () => ({
  getModel: vi.fn(),
}));

import { createWorkerSession } from "../src/session.js";

describe("createWorkerSession", () => {
  beforeEach(() => {
    mockCreateAgentSession.mockReset();
    mockDiscoverAndLoadExtensions.mockReset();
    mockSessionManager.mockReset();
    mockCreateAgentSession.mockResolvedValue({ session: { id: "fresh-worker" } });
    mockSessionManager.mockReturnValue({ kind: "in-memory" });
  });

  it("按 T3 默认创建逻辑隔离的 fresh session", async () => {
    const model = { provider: "provider", id: "fast" };
    const worker = await createWorkerSession({
      tier: "T3",
      cwd: "/workspace",
      modelStr: "provider/fast",
      ctx: { modelRegistry: { find: vi.fn(() => model), authStorage: {} } },
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
