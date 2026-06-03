/**
 * P2/eventStream 单元测试
 *
 * 覆盖：start/stop 生命周期、view 合并去重、seal 收口、桥接到 SignalLog
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SignalBus } from "../../src/P1/signalBus.js";
import { SignalLog } from "../../src/P1/signalLog.js";
import { EventStream } from "../../src/P2/eventStream.js";

let cwd: string;

beforeEach(async () => {
  cwd = await mkdtemp(join(tmpdir(), "event-stream-test-"));
});

afterEach(async () => {
  await rm(cwd, { recursive: true, force: true });
});

describe("P2/eventStream", () => {
  describe("start / stop", () => {
    it("初始 active=false", () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      expect(es.active).toBe(false);
    });

    it("start 后 active=true", () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();
      expect(es.active).toBe(true);
    });

    it("start 二次调用是 no-op（不重复订阅）", () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();
      es.start();
      es.start();
      expect(es.active).toBe(true);
      es.stop();
    });

    it("stop 后 active=false", () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();
      es.stop();
      expect(es.active).toBe(false);
    });

    it("stop 二次调用是 no-op（幂等）", () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();
      es.stop();
      es.stop();
      es.stop();
      expect(es.active).toBe(false);
    });
  });

  describe("桥接 bus → log", () => {
    it("emit 信号后，log 文件应包含该事件", async () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();

      bus.emit("progress", "w-1", { pct: 50 });
      // handle() 是 async 的（await this.log.append），给一点时间
      await sleep(50);

      const content = await readFile(log.path, "utf-8");
      const lines = content.trim().split("\n");
      expect(lines).toHaveLength(1);
      const event = JSON.parse(lines[0]);
      expect(event).toMatchObject({
        type: "progress",
        src: "w-1",
        data: { pct: 50 },
      });
    });

    it("4 种 type 都能桥接", async () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();

      bus.emit("progress", "w-1", {});
      bus.emit("blocked", "w-1", {});
      bus.emit("found", "w-1", {});
      bus.emit("help", "w-1", {});

      await sleep(100);

      const recent = await es.view();
      expect(recent).toHaveLength(4);
      const types = new Set(recent.map((e) => e.type));
      expect(types).toEqual(new Set(["progress", "blocked", "found", "help"]));
    });

    it("stop 后 emit 不再桥接到 log（但仍记录到 bus）", async () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();

      bus.emit("progress", "w-1", { n: 1 });
      await sleep(50); // 等桥接写入 log

      es.stop();
      bus.emit("progress", "w-1", { n: 2 });
      await sleep(50);

      // 核心断言：log 里只有 1 条（stop 前那 1 条）
      // stop 后 emit 的 n=2 不进 log（这是 EventStream 的职责）
      const logOnly = await log.recent({ includeExpired: true });
      expect(logOnly).toHaveLength(1);
      expect(logOnly[0].data).toEqual({ n: 1 });

      // bus history 仍记录了 2 条（SignalBus 不受 EventStream.stop 影响）
      expect(bus.getHistory()).toHaveLength(2);

      // view() 是合并视图，会看到 2 条（id 不同不去重）——这是设计预期
      const view = await es.view();
      expect(view).toHaveLength(2);
    });

    it("桥接不破坏 SignalBus 现有 API（emit/on/getHistory 仍可独立用）", async () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();

      const unsub = bus.on("progress", (sig) => {
        expect(sig.type).toBe("progress");
      });

      bus.emit("progress", "w-1", { ok: true });
      await sleep(50);

      // SignalBus.getHistory 仍能用
      const hist = bus.getHistory();
      expect(hist).toHaveLength(1);
      expect(hist[0].data).toEqual({ ok: true });

      unsub();
      es.stop();
    });
  });

  describe("view 合并去重", () => {
    it("bus history 和 log file 都有同一事件时，去重保留一份", async () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();

      bus.emit("progress", "w-1", { n: 1 });
      await sleep(50);

      // 此时 bus.getHistory() 和 log.recent() 都有这条
      const histCount = bus.getHistory().length;
      const fileCount = (await log.recent({ includeExpired: true })).length;
      expect(histCount).toBe(1);
      expect(fileCount).toBe(1);

      // view() 应该返回 1 条（去重）
      const view = await es.view();
      expect(view).toHaveLength(1);
    });

    it("limit 生效", async () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();

      for (let i = 0; i < 10; i++) {
        bus.emit("progress", "w-1", { n: i });
        await sleep(2); // 让 ts 递增
      }
      await sleep(100);

      const view = await es.view({ limit: 3 });
      expect(view).toHaveLength(3);
      expect(view[view.length - 1].data).toEqual({ n: 9 });
    });
  });

  describe("seal", () => {
    it("seal 后 active=false 且 log 归档", async () => {
      const bus = new SignalBus();
      const log = new SignalLog({ cwd, runId: "r1" });
      const es = new EventStream(bus, log);
      es.start();

      bus.emit("progress", "w-1", { n: 1 });
      await sleep(50);

      const result = await es.seal();
      expect(result.count).toBe(1);
      expect(result.sealedTo).toBe(join(cwd, ".dteam/signal/archive/r1.1.jsonl"));
      expect(es.active).toBe(false);

      // 归档文件有内容
      const archive = await readFile(result.sealedTo, "utf-8");
      expect(archive.trim().split("\n")).toHaveLength(1);
    });
  });
});

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
