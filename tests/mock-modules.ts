import { mock } from "bun:test";

/** Shared Bun mocks: Bun keeps mocked modules process-wide rather than per test file. */
export const mockCreateWorkerSession = mock();
export const mockSetActiveToolsByName = mock();
export const mockRegisterNativeProvider = mock();
export const mockRegisterProvider = mock();
export const mockModelRuntime = {
  registerNativeProvider: mockRegisterNativeProvider,
  registerProvider: mockRegisterProvider,
};
export const mockModelRuntimeCreate = mock(async () => mockModelRuntime);
export const mockCreateAgentSession = mock(async (options: any) => ({
  session: options.tools?.includes("edit")
    ? { setActiveToolsByName: mockSetActiveToolsByName }
    : { id: "fresh-worker" },
}));
export const mockDiscoverAndLoadExtensions = mock();
export const mockSessionManager = mock();
export const mockSettingsManager = mock(() => ({}));
export const mockCreateExtensionRuntime = mock(() => ({}));
mock.module("../src/session.js", () => ({
  createWorkerSession: mockCreateWorkerSession,
}));

mock.module("@earendil-works/pi-coding-agent", () => ({
  createAgentSession: mockCreateAgentSession,
  createExtensionRuntime: mockCreateExtensionRuntime,
  discoverAndLoadExtensions: mockDiscoverAndLoadExtensions,
  ModelRuntime: { create: mockModelRuntimeCreate },
  SessionManager: { inMemory: mockSessionManager },
  SettingsManager: { inMemory: mockSettingsManager },
}));
