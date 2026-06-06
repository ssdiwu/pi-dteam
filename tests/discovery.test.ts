/**
 * discovery.test.ts — 测试 src/session/discovery.ts
 *
 * 覆盖：
 *  - listAvailableTools：枚举已加载扩展的工具
 *  - formatToolsForPrompt：格式化为 LLM prompt 片段
 *
 * 策略：vi.mock @earendil-works/pi-coding-agent，避免真扫盘和真扩展加载
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockDiscoverAndLoadExtensions } = vi.hoisted(() => ({
  mockDiscoverAndLoadExtensions: vi.fn(),
}));

vi.mock("@earendil-works/pi-coding-agent", () => ({
  discoverAndLoadExtensions: mockDiscoverAndLoadExtensions,
}));

import {
  listAvailableTools,
  formatToolsForPrompt,
} from "../src/session/discovery.js";

/** 构造单个扩展的最小 mock */
function makeExt(path: string, tools: Array<[string, { definition: { name: string; description?: string } }]>) {
  return {
    path,
    resolvedPath: `/${path}`,
    sourceInfo: {} as any,
    handlers: new Map(),
    tools: new Map(tools),
    messageRenderers: new Map(),
    commands: new Map(),
    flags: new Map(),
    shortcuts: new Map(),
  };
}

describe("listAvailableTools", () => {
  beforeEach(() => {
    mockDiscoverAndLoadExtensions.mockReset();
  });

  it("返回所有扩展的工具，扁平化 name + description + source", async () => {
    mockDiscoverAndLoadExtensions.mockResolvedValue({
      extensions: [
        makeExt("ext1", [
          ["foo", { definition: { name: "foo", description: "does foo" } }],
          ["bar", { definition: { name: "bar", description: "does bar" } }],
        ]),
        makeExt("ext2", [
          ["baz", { definition: { name: "baz" } }], // 缺 description
        ]),
      ],
      errors: [],
      runtime: {} as any,
    });

    const tools = await listAvailableTools("/tmp");
    expect(tools).toEqual([
      { name: "foo", description: "does foo", source: "ext1" },
      { name: "bar", description: "does bar", source: "ext1" },
      { name: "baz", description: undefined, source: "ext2" },
    ]);
  });

  it("无扩展 → 空数组", async () => {
    mockDiscoverAndLoadExtensions.mockResolvedValue({
      extensions: [],
      errors: [],
      runtime: {} as any,
    });
    expect(await listAvailableTools("/tmp")).toEqual([]);
  });

  it("扩展报错不影响主流程：errors 字段不参与工具枚举", async () => {
    mockDiscoverAndLoadExtensions.mockResolvedValue({
      extensions: [
        makeExt("ext1", [["ok", { definition: { name: "ok" } }]]),
      ],
      errors: [{ path: "bad1", error: "load failed" }],
      runtime: {} as any,
    });
    const tools = await listAvailableTools("/tmp");
    expect(tools).toHaveLength(1);
    expect(tools[0].name).toBe("ok");
  });
});

describe("formatToolsForPrompt", () => {
  it("有空工具 → '（无）'", () => {
    expect(formatToolsForPrompt([])).toBe("（无）");
  });

  it("有 description → '- name: description'", () => {
    expect(formatToolsForPrompt([
      { name: "x", description: "d", source: "s" },
    ])).toBe("- x: d");
  });

  it("缺 description → 只给 '- name'", () => {
    expect(formatToolsForPrompt([
      { name: "x", source: "s" },
    ])).toBe("- x");
  });

  it("多个工具用换行分隔", () => {
    expect(formatToolsForPrompt([
      { name: "a", description: "da", source: "s" },
      { name: "b", source: "s" },
      { name: "c", description: "dc", source: "s" },
    ])).toBe("- a: da\n- b\n- c: dc");
  });
});
