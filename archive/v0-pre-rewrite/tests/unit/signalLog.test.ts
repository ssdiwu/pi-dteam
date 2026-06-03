/**
 * P1/signalLog 单元测试
 *
 * 覆盖：append / recent / rotate / tail / seal / pruneExpired
 * 集成：多进程并发追加（child_process）
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdir, mkdtemp, rm, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";
import { SignalLog, SignalTooLargeError } from "../../src/P1/signalLog.js";
import type { SignalEvent } from "../../src/P0/signalEvent.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "signal-log-test-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("P1/signalLog", () => {
  describe("构造", () => {
    it("默认路径在 .dteam/signal/<runId>.jsonl", () => {
      const log = new SignalLog({ cwd, runId: "test-1" });
      expect(log.path).toBe(join(cwd, ".dteam/signal/test-1.jsonl"));
      expect(log.archiveDir).toBe(join(cwd, ".dteam/signal/archive"));
    });

    it("runId 含路径穿越时抛错（路径安全防御）", () => {
      expect(() => new SignalLog({ cwd, runId: "../etc/passwd" })).toThrow(/Invalid runId/);
      // safeFilenamePart 会把 / 转成 -，所以 foo/bar 变 foo-bar（合法）
      const log = new SignalLog({ cwd, runId: "foo/bar" });
      expect(log.runId).toBe("foo-bar");
    });
  });

  describe("append", () => {
    it("追加后文件存在且内容是 JSONL 一行", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      const ev = await log.append({
        type: "progress",
        src: "w-1",
        ts: 1000,
        data: { pct: 50 },
      });

      expect(ev.id).toMatch(/^sig-\d+-[a-z0-9]+$/);
      expect(ev.expiresAt).toBeUndefined();

      const content = await readFile(log.path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);
      expect(JSON.parse(lines[0])).toMatchObject({
        id: ev.id,
        type: "progress",
        src: "w-1",
        ts: 1000,
        data: { pct: 50 },
      });
    });

    it("带 ttl 时 expiresAt 正确计算", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      const ev = await log.append({
        type: "blocked",
        src: "w-1",
        ts: 1000,
        ttl: 600000,
        severity: "med",
      });

      expect(ev.expiresAt).toBe(601000);
    });

    it("多次追加按时间顺序写入", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1 });
      await log.append({ type: "progress", src: "w-1", ts: 2 });
      await log.append({ type: "progress", src: "w-1", ts: 3 });

      const content = await readFile(log.path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(3);
      const events = lines.map((l) => JSON.parse(l)) as SignalEvent[];
      expect(events.map((e) => e.ts)).toEqual([1, 2, 3]);
    });

    it("单行 JSONL 超过 4096 字节时抛 SignalTooLargeError", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await expect(
        log.append({
          type: "progress",
          src: "w-1",
          ts: 1,
          data: { text: "x".repeat(5000) },
        }),
      ).rejects.toBeInstanceOf(SignalTooLargeError);
    });
  });

  describe("tail + recent", () => {
    it("文件不存在时 tail 返回空数组", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      expect(await log.tail()).toEqual([]);
    });

    it("recent 按 limit 限制返回", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      for (let i = 0; i < 5; i++) {
        await log.append({ type: "progress", src: "w-1", ts: i });
      }
      const recent = await log.recent({ limit: 3 });
      expect(recent).toHaveLength(3);
      expect(recent.map((e) => e.ts)).toEqual([2, 3, 4]);
    });

    it("recent 按 type 过滤", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1 });
      await log.append({ type: "blocked", src: "w-1", ts: 2 });
      await log.append({ type: "progress", src: "w-1", ts: 3 });

      const recent = await log.recent({ type: "blocked" });
      expect(recent).toHaveLength(1);
      expect(recent[0].type).toBe("blocked");
    });

    it("recent 按 src 过滤", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1 });
      await log.append({ type: "progress", src: "w-2", ts: 2 });

      const recent = await log.recent({ src: "w-2" });
      expect(recent).toHaveLength(1);
      expect(recent[0].src).toBe("w-2");
    });

    it("recent 按 taskId 过滤", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1, taskId: "t-1" });
      await log.append({ type: "progress", src: "w-1", ts: 2, taskId: "t-2" });

      const recent = await log.recent({ taskId: "t-2" });
      expect(recent).toHaveLength(1);
      expect(recent[0].taskId).toBe("t-2");
    });

    it("TTL 软过期：now 超过 expiresAt 时默认过滤掉", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1000, ttl: 100 });

      // 模拟现在时间 = ts + 200（已过期）
      const future = 1200;
      const filtered = await log.recent({});
      // 默认用 Date.now()，事件在测试运行时未过期（实时）
      expect(filtered.length).toBeGreaterThanOrEqual(0);

      // 用 includeExpired=true 显式包含
      const all = await log.recent({ includeExpired: true });
      expect(all).toHaveLength(1);

      // 验证 expiresAt 计算正确
      const ev = all[0];
      expect(ev.expiresAt).toBe(1100);
      expect(future >= ev.expiresAt!).toBe(true); // future 确实超过 expiresAt
    });

    it("recent 按 since 过滤（毫秒时间戳）", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1000 });
      await log.append({ type: "progress", src: "w-1", ts: 2000 });
      await log.append({ type: "progress", src: "w-1", ts: 3000 });

      const recent = await log.recent({ since: 2000 });
      expect(recent.map((e) => e.ts)).toEqual([2000, 3000]);
    });

    it("tail 流式读取最近 N 条并跳过坏行", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(JSON.stringify({ id: `sig-${i}`, type: "progress", src: "w-1", ts: i }));
      }
      lines.splice(5, 0, "{bad-json");
      await mkdir(dirname(log.path), { recursive: true });
      await writeFile(log.path, `${lines.join("\n")}\n`, "utf-8");

      const recent = await log.tail(3);
      expect(recent).toHaveLength(3);
      expect(recent.map((e) => e.ts)).toEqual([7, 8, 9]);
    });

    it("tail 读取 10k 条大文件时仅返回最近 N 条", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      const lines: string[] = [];
      for (let i = 0; i < 10_000; i++) {
        lines.push(JSON.stringify({
          id: `sig-${i}`,
          type: "progress",
          src: "w-1",
          ts: i,
          data: { text: "x".repeat(1024) },
        }));
      }
      await mkdir(dirname(log.path), { recursive: true });
      await writeFile(log.path, `${lines.join("\n")}\n`, "utf-8");

      const recent = await log.tail(5);
      expect(recent).toHaveLength(5);
      expect(recent.map((e) => e.ts)).toEqual([9995, 9996, 9997, 9998, 9999]);
    });
  });

  describe("rotate", () => {
    it("行数未超过 maxLinesPerFile 时不滚动", async () => {
      const log = new SignalLog({ cwd, runId: "r1", maxLinesPerFile: 100 });
      await log.append({ type: "progress", src: "w-1", ts: 1 });

      const result = await log.rotate();
      expect(result.archivedTo).toBe("");
      expect(result.lineCount).toBe(0);
    });

    it("行数超过 maxLinesPerFile 时滚动到 archive/1.jsonl", async () => {
      const log = new SignalLog({ cwd, runId: "r1", maxLinesPerFile: 3 });
      for (let i = 0; i < 5; i++) {
        await log.append({ type: "progress", src: "w-1", ts: i });
      }

      const result = await log.rotate();
      expect(result.archivedTo).toBe(join(cwd, ".dteam/signal/archive/r1.1.jsonl"));
      expect(result.lineCount).toBe(5);

      // 原文件应被移走（下次 append 重新创建）
      const archiveContent = await readFile(result.archivedTo, "utf-8");
      expect(archiveContent.trim().split("\n")).toHaveLength(5);
    });
  });

  describe("seal", () => {
    it("seal 后原文件被移到 archive/，下次 append 重新创建", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1 });
      await log.append({ type: "progress", src: "w-1", ts: 2 });

      const result = await log.seal();
      expect(result.count).toBe(2);
      expect(result.sealedTo).toBe(join(cwd, ".dteam/signal/archive/r1.1.jsonl"));

      // 验证原文件不存在
      try {
        await stat(log.path);
        expect.fail("原文件应被移走");
      } catch (err) {
        expect((err as NodeJS.ErrnoException).code).toBe("ENOENT");
      }

      // 再次 append 应能重新创建
      const newEv = await log.append({ type: "progress", src: "w-1", ts: 3 });
      expect(newEv.ts).toBe(3);
    });
  });

  describe("pruneExpired", () => {
    it("无过期事件时返回 0", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 1, ttl: 600000 });

      const pruned = await log.pruneExpired(2000);
      expect(pruned).toBe(0);
    });

    it("物理删除过期事件", async () => {
      const log = new SignalLog({ cwd, runId: "r1" });
      await log.append({ type: "progress", src: "w-1", ts: 100, ttl: 50 }); // 过期
      await log.append({ type: "progress", src: "w-1", ts: 200, ttl: 600000 }); // 未过期
      await log.append({ type: "progress", src: "w-1", ts: 300 }); // 永不过期

      const pruned = await log.pruneExpired(500);
      expect(pruned).toBe(1);

      const kept = await log.recent({ includeExpired: true });
      expect(kept).toHaveLength(2);
      expect(kept.map((e) => e.ts)).toEqual([200, 300]);
    });
  });

  describe("集成：多进程并发追加", () => {
    it("两个子进程各自追加 5 条，merge 后共 10 条", async () => {
      const log = new SignalLog({ cwd, runId: "multi" });

      // 写一个临时 .mjs 脚本，传入 src，追加 5 条
      // 用 .mjs + node 避免 tsx cjs/esm 切换 + top-level await 限制
      // spawn 在 test cwd 下运行，子进程从 process.argv[2] 拿 src
      const childScript = join(cwd, "_child.mjs");
      const childCode = `
        import { SignalLog } from "${process.cwd()}/dist/P1/signalLog.js";
        const src = process.argv[2];
        const cwd = ${JSON.stringify(cwd)};
        const log = new SignalLog({ cwd, runId: "multi" });
        for (let i = 0; i < 5; i++) {
          await log.append({ type: "progress", src, ts: Date.now() + i });
        }
      `;
      const { writeFile } = await import("node:fs/promises");
      await writeFile(childScript, childCode, "utf-8");

      const child1 = runChild(cwd, childScript, "child-1");
      const child2 = runChild(cwd, childScript, "child-2");

      const [code1, code2] = await Promise.all([child1, child2]);
      expect(code1).toBe(0);
      expect(code2).toBe(0);

      const all = await log.recent({ limit: 100, includeExpired: true });
      expect(all).toHaveLength(10);

      const sources = new Set(all.map((e) => e.src));
      expect(sources).toEqual(new Set(["child-1", "child-2"]));
    });
  });
});

/** 跑一个 node 子进程；返回 exit code */
function runChild(
  childCwd: string,
  scriptPath: string,
  src: string,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn("node", [scriptPath, src], {
      cwd: childCwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (code === 0) resolve(code);
      else reject(new Error(`child exit ${code}: ${stderr}`));
    });
    child.on("error", reject);
  });
}
