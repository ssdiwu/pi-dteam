import { mockCreateAgentSession, mockSessionManager, mockSetActiveToolsByName } from "./mock-modules.js";
import { describe, expect, it, mock, beforeEach } from "bun:test";
import { createToolPolicy, validateRequestedTools } from "../src/runtime/tool-policy.js";

const { createWorkerSession } = await import("../src/session.js?dynamic-tools");

function policy(addTools: string[] = []) {
  return createToolPolicy({
    baseTools: ["read", "grep"],
    addTools,
    parentActiveTools: ["read", "grep", "bash", "edit"],
    signalToolName: "dteam_signal",
  });
}

describe("0.8 dynamic tool policy", () => {
  it("初始 active set 只包含基础工具和 signal", () => {
    expect(policy(["edit"])).toEqual({
      baseTools: ["read", "grep"],
      addTools: ["edit"],
      initialActiveTools: ["read", "grep", "dteam_signal"],
    });
  });

  it.each([
    ["unknown", "dteam: addTools 工具未获当前主会话授权 unknown"],
    ["dteam_signal", "dteam: addTools 工具未获当前主会话授权 dteam_signal"],
  ])("拒绝候选工具 %s", (name, message) => {
    expect(() => policy([name])).toThrow(message);
  });

  it("对当前会话虽可见的第三方工具明确降级拒绝", () => {
    expect(() => createToolPolicy({
      baseTools: ["read"], addTools: ["tinyfish_search"],
      parentActiveTools: ["read", "tinyfish_search"], signalToolName: "dteam_signal",
    })).toThrow("尚不支持最小安全加载 tinyfish_search");
  });

  it("拒绝重复候选和候选外 request_tools", () => {
    expect(() => policy(["edit", "edit"])).toThrow("包含重复工具 edit");
    expect(() => validateRequestedTools(["bash"], policy(["edit"]))).toThrow("只能申请本次 addTools 候选 bash");
    expect(validateRequestedTools(["edit"], policy(["edit"]))).toEqual(["edit"]);
  });
});

describe("createWorkerSession dynamic active tools", () => {
  beforeEach(() => {
    mockSetActiveToolsByName.mockClear();
    mockSessionManager.mockClear();
    mockSessionManager.mockReturnValue({ kind: "in-memory" });
  });

  it("先注册候选工具，再在首次 prompt 前收窄 active set", async () => {
    await createWorkerSession({
      cwd: "/workspace",
      modelStr: "provider/model",
      ctx: { modelRegistry: { authStorage: {}, find: mock(() => ({ provider: "provider", id: "model" })) } },
      builtInTools: ["read"],
      registeredTools: ["read", "edit", "dteam_signal"],
      initialActiveTools: ["read", "dteam_signal"],
      customTools: [],
      logicalIsolation: true,
    });

    expect(mockCreateAgentSession).toHaveBeenCalledWith(expect.objectContaining({
      tools: ["read", "edit", "dteam_signal"],
    }));
    expect(mockSetActiveToolsByName).toHaveBeenCalledWith(["read", "dteam_signal"]);
  });
});
