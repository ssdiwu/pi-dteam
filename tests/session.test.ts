import {
  mockCreateAgentSession,
  mockDiscoverAndLoadExtensions,
  mockModelRuntime,
  mockModelRuntimeCreate,
  mockRegisterNativeProvider,
  mockRegisterProvider,
  mockSessionManager,
} from "./mock-modules.js";
import { beforeEach, describe, expect, it, mock } from "bun:test";

const { createWorkerSession } = await import("../src/session.js?session-test");

describe("createWorkerSession", () => {
  beforeEach(() => {
    mockCreateAgentSession.mockClear();
    mockDiscoverAndLoadExtensions.mockClear();
    mockModelRuntimeCreate.mockClear();
    mockRegisterNativeProvider.mockClear();
    mockRegisterProvider.mockClear();
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

  it("把所选模型的 native provider 复制到 fresh runtime", async () => {
    const model = { provider: "custom-native", id: "model" };
    const nativeProvider = { id: "custom-native" };
    const getRegisteredProviderConfig = mock(() => ({ baseUrl: "https://unused.example" }));
    const modelRegistry = {
      find: mock(() => model),
      getRegisteredNativeProvider: mock(() => nativeProvider),
      getRegisteredProviderConfig,
    };

    await createWorkerSession({
      cwd: "/workspace",
      modelStr: "custom-native/model",
      ctx: { modelRegistry },
      logicalIsolation: true,
    });

    expect(mockModelRuntimeCreate).toHaveBeenCalledTimes(1);
    expect(modelRegistry.getRegisteredNativeProvider).toHaveBeenCalledWith("custom-native");
    expect(mockRegisterNativeProvider).toHaveBeenCalledWith(nativeProvider);
    expect(getRegisteredProviderConfig).not.toHaveBeenCalled();
    expect(mockRegisterProvider).not.toHaveBeenCalled();
    const options = mockCreateAgentSession.mock.calls.at(-1)?.[0];
    expect(options.modelRuntime).toBe(mockModelRuntime);
    expect(options.authStorage).toBeUndefined();
    expect(options.modelRegistry).toBeUndefined();
  });

  it("native provider 缺失时复制所选模型的 provider config", async () => {
    const model = { provider: "custom-config", id: "model" };
    const providerConfig = { baseUrl: "https://config.example" };
    const modelRegistry = {
      find: mock(() => model),
      getRegisteredNativeProvider: mock(() => undefined),
      getRegisteredProviderConfig: mock(() => providerConfig),
    };

    await createWorkerSession({
      cwd: "/workspace",
      modelStr: "custom-config/model",
      ctx: { modelRegistry },
      logicalIsolation: true,
    });

    expect(modelRegistry.getRegisteredProviderConfig).toHaveBeenCalledWith("custom-config");
    expect(mockRegisterNativeProvider).not.toHaveBeenCalled();
    expect(mockRegisterProvider).toHaveBeenCalledWith("custom-config", providerConfig);
    expect(mockCreateAgentSession.mock.calls.at(-1)?.[0].modelRuntime).toBe(mockModelRuntime);
  });
});
