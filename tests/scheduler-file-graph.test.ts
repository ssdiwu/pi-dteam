import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildFileGraph, buildFileGraphFromSteps, extractSpecifiers } from "../src/scheduler/index.js";
import type { PlanStep } from "../src/tools.js";

let cwd: string;

beforeEach(() => {
  cwd = mkdtempSync(path.join(tmpdir(), "dteam-file-graph-"));
});

afterEach(() => {
  rmSync(cwd, { recursive: true, force: true });
});

function file(relativePath: string, content: string): void {
  const absolute = path.join(cwd, relativePath);
  mkdirSync(path.dirname(absolute), { recursive: true });
  writeFileSync(absolute, content);
}

describe("extractSpecifiers", () => {
  it("解析 import / export from / require", () => {
    expect(extractSpecifiers(`
      import x from "./x";
      import "./side-effect";
      export { y } from "./y";
      export * from "./z";
      const c = require("./c");
    `)).toEqual(["./x", "./side-effect", "./y", "./z", "./c"]);
  });
});

describe("buildFileGraph", () => {
  it("解析相对 import 并建立 importedBy", () => {
    file("src/a.ts", `import { b } from "./b";`);
    file("src/b.ts", `export const b = 1;`);

    const graph = buildFileGraph(["src/a.ts"], { cwd });

    expect(graph.boundaryStatus).toBe("known");
    expect(graph.roots).toEqual(["src/a.ts"]);
    expect(graph.nodes.find((node) => node.file === "src/a.ts")?.imports).toEqual(["src/b.ts"]);
    expect(graph.nodes.find((node) => node.file === "src/b.ts")?.importedBy).toEqual(["src/a.ts"]);
  });

  it("解析目录 index 文件", () => {
    file("src/a.ts", `import { b } from "./b";`);
    file("src/b/index.ts", `export const b = 1;`);

    const graph = buildFileGraph(["src/a.ts"], { cwd });

    expect(graph.boundaryStatus).toBe("known");
    expect(graph.nodes.find((node) => node.file === "src/a.ts")?.imports).toEqual(["src/b/index.ts"]);
  });

  it("解析 require", () => {
    file("src/a.cjs", `const b = require("./b");`);
    file("src/b.js", `module.exports = 1;`);

    const graph = buildFileGraph(["src/a.cjs"], { cwd });

    expect(graph.boundaryStatus).toBe("known");
    expect(graph.nodes.find((node) => node.file === "src/a.cjs")?.imports).toEqual(["src/b.js"]);
  });

  it("缺失 root 文件时标记 unresolved，不抛错", () => {
    const graph = buildFileGraph(["src/missing.ts"], { cwd });

    expect(graph.boundaryStatus).toBe("unresolved");
    expect(graph.nodes).toMatchObject([{ file: "src/missing.ts", exists: false }]);
    expect(graph.unresolved[0]).toMatchObject({ from: "src/missing.ts", reason: "文件不存在" });
  });

  it("非 JS/TS 文件作为 root 只记录节点，不扫描内容", () => {
    file("README.md", `import x from "./src/x";`);

    const graph = buildFileGraph(["README.md"], { cwd });

    expect(graph.boundaryStatus).toBe("known");
    expect(graph.nodes).toMatchObject([{ file: "README.md", imports: [], exists: true }]);
  });

  it("扫描超限时标记 truncated", () => {
    file("src/a.ts", `import "./b";`);
    file("src/b.ts", `export const b = 1;`);

    const graph = buildFileGraph(["src/a.ts"], { cwd, maxScanFiles: 1 });

    expect(graph.boundaryStatus).toBe("truncated");
    expect(graph.truncated).toBe(true);
    expect(graph.nodes).toHaveLength(1);
  });
});

describe("buildFileGraphFromSteps", () => {
  it("从 PlanStep.files 聚合 roots", () => {
    file("src/a.ts", `export const a = 1;`);
    file("src/b.ts", `export const b = 1;`);
    const steps: PlanStep[] = [
      { role: "explore", task: "读 a", strategy: "direct", files: ["src/a.ts"] },
      { role: "build", task: "改 b", strategy: "direct", files: ["src/b.ts", "src/a.ts"] },
    ];

    const graph = buildFileGraphFromSteps(steps, { cwd });

    expect(graph.boundaryStatus).toBe("known");
    expect(graph.roots).toEqual(["src/a.ts", "src/b.ts"]);
  });

  it("缺少 files 的 step 标记 unknown，但不阻塞已知文件扫描", () => {
    file("src/a.ts", `export const a = 1;`);
    const steps: PlanStep[] = [
      { role: "explore", task: "读 a", strategy: "direct", files: ["src/a.ts"] },
      { role: "design", task: "想方案", strategy: "direct" },
    ];

    const graph = buildFileGraphFromSteps(steps, { cwd });

    expect(graph.boundaryStatus).toBe("unknown");
    expect(graph.nodes).toMatchObject([{ file: "src/a.ts", exists: true }]);
  });
});
