/**
 * P1-分子层：信号日志
 *
 * dteam 信息素层 P1 服务层。基于 JSONL + POSIX O_APPEND 原子追加，
 * 提供 append / recent / rotate / tail / seal / pruneExpired 6 个方法。
 *
 * 设计依据：task `20260601175426-mtgl` 讨论决策 → 实施 task `20260601180517-9vc9` AC2。
 */

import { createReadStream } from "node:fs";
import { open, mkdir, rename, unlink } from "node:fs/promises";
import { createInterface } from "node:readline";
import { join, dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { isExpired, computeExpiresAt, type SignalEvent } from "../P0/signalEvent.js";
import { assertInside, safeFilenamePart } from "../P0/pathSafety.js";
import type { SignalType } from "../P0/signal.js";

export interface SignalLogOptions {
  cwd: string;
  runId: string;
  maxLinesPerFile?: number;
  signalDir?: string;
}

export interface RecentQuery {
  type?: SignalType;
  src?: string;
  taskId?: string;
  since?: number;
  limit?: number;
  includeExpired?: boolean;
}

const DEFAULT_MAX_LINES = 10_000;
const DEFAULT_SIGNAL_DIR = ".dteam/signal";
const READ_BATCH = 1000;
const ID_RANDOM_BYTES = 3;
export const MAX_SIGNAL_LINE_BYTES = 4096;

/** 单条 SignalLog JSONL 记录超过原子追加安全边界。 */
export class SignalTooLargeError extends Error {
  constructor(readonly bytes: number, readonly maxBytes: number = MAX_SIGNAL_LINE_BYTES) {
    super(`Signal event line is too large: ${bytes} bytes (max < ${maxBytes})`);
    this.name = "SignalTooLargeError";
  }
}

/**
 * 信号日志：append-only JSONL 文件 + TTL 软过期 + 文件滚动 + 收口归档。
 *
 * 与 SignalBus（进程内内存）相对，SignalLog 是文件级持久化形态：
 *  - 跨进程可读
 *  - 进程重启可恢复
 *  - append 不锁（POSIX O_APPEND 行级原子）
 *  - TTL 软过期（读取时过滤，文件不删）
 */
export class SignalLog {
  readonly path: string;
  readonly archiveDir: string;
  private readonly cwd: string;
  private readonly runId: string;
  private readonly maxLinesPerFile: number;

  constructor(opts: SignalLogOptions) {
    this.cwd = opts.cwd;
    this.runId = safeFilenamePart(opts.runId, "run");

    // 防御性检查：safeFilenamePart 不会去除连续点（..），需在此拒绝路径穿透
    if (this.runId.includes("..")) {
      throw new Error(`Invalid runId after sanitization: ${this.runId}`);
    }

    this.maxLinesPerFile = opts.maxLinesPerFile ?? DEFAULT_MAX_LINES;

    const signalDir = opts.signalDir ?? DEFAULT_SIGNAL_DIR;
    const signalAbsDir = join(opts.cwd, signalDir);
    this.path = join(signalAbsDir, `${this.runId}.jsonl`);
    this.archiveDir = join(signalAbsDir, "archive");
    assertInside(opts.cwd, this.path);
    assertInside(opts.cwd, this.archiveDir);
  }

  /**
   * 追加一条事件（POSIX O_APPEND 原子追加）。
   * 写前自动计算 expiresAt；写后返回完整事件（含 id/expiresAt）。
   * 可选传入 id 覆盖默认生成的 id（用于事件源共享同一 id，如 SignalBus 桥接）。
   */
  async append(
    event: Omit<SignalEvent, "id" | "expiresAt">,
    options?: { id?: string },
  ): Promise<SignalEvent> {
    const full: SignalEvent = {
      ...event,
      id: options?.id ?? generateId(),
      expiresAt: computeExpiresAt(event),
    };

    const line = JSON.stringify(full) + "\n";
    const bytes = Buffer.byteLength(line, "utf8");
    if (bytes >= MAX_SIGNAL_LINE_BYTES) {
      throw new SignalTooLargeError(bytes);
    }

    const dir = dirname(this.path);
    await mkdir(dir, { recursive: true });

    // 'a' = O_WRONLY | O_CREAT | O_APPEND；POSIX 保证 < PIPE_BUF 的 write 原子
    const handle = await open(this.path, "a");
    try {
      await handle.write(line);
    } finally {
      await handle.close();
    }

    return full;
  }

  /**
   * 读最近 N 条，可按 type/src/taskId/since 过滤；TTL 软过滤。
   * limit 默认 100。
   */
  async recent(query: RecentQuery = {}): Promise<SignalEvent[]> {
    const all = await this.tail(READ_BATCH);
    const now = Date.now();
    const limit = query.limit ?? 100;
    const filtered: SignalEvent[] = [];

    for (const ev of all) {
      if (!query.includeExpired && isExpired(ev, now)) continue;
      if (query.type && ev.type !== query.type) continue;
      if (query.src && ev.src !== query.src) continue;
      if (query.taskId && ev.taskId !== query.taskId) continue;
      if (query.since && ev.ts < query.since) continue;
      filtered.push(ev);
    }

    // 取最后 limit 条（按时间顺序的最后 N 个）
    return filtered.slice(-limit);
  }

  /**
   * 物理滚动：单文件 > maxLinesPerFile 时，把当前文件 rename 到 archive/。
   * 下次 append 时会重新创建 .dteam/signal/<runId>.jsonl。
   */
  async rotate(): Promise<{ archivedTo: string; lineCount: number }> {
    const all = await this.tail(Number.MAX_SAFE_INTEGER);
    if (all.length < this.maxLinesPerFile) {
      return { archivedTo: "", lineCount: 0 };
    }

    await mkdir(this.archiveDir, { recursive: true });
    const seq = await this.nextSeq();
    const archivedTo = join(this.archiveDir, `${this.runId}.${seq}.jsonl`);
    await rename(this.path, archivedTo);

    return { archivedTo, lineCount: all.length };
  }

  /**
   * 读全部（按行数限制），返回按时间升序的事件数组。
   * 解析失败的行跳过（不抛错），保证读取可恢复。
   */
  async tail(maxLines: number = READ_BATCH): Promise<SignalEvent[]> {
    if (maxLines <= 0) return [];

    const events: SignalEvent[] = [];
    const input = createReadStream(this.path, { encoding: "utf-8" });
    const rl = createInterface({ input, crlfDelay: Infinity });

    try {
      for await (const line of rl) {
        if (!line) continue;
        try {
          events.push(JSON.parse(line) as SignalEvent);
          if (events.length > maxLines) events.shift();
        } catch {
          // 跳过坏行（不抛错）
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    } finally {
      rl.close();
      input.destroy();
    }

    return events;
  }

  /**
   * 收口归档：把当前 jsonl 文件 rename 到 archive/，不再 append。
   * 用于 /close 或 worker_cancel 收尾。
   */
  async seal(): Promise<{ sealedTo: string; count: number }> {
    let count = 0;
    try {
      const all = await this.tail(Number.MAX_SAFE_INTEGER);
      count = all.length;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    let sealedTo = "";
    try {
      await mkdir(this.archiveDir, { recursive: true });
      const seq = await this.nextSeq();
      sealedTo = join(this.archiveDir, `${this.runId}.${seq}.jsonl`);
      await rename(this.path, sealedTo);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }

    return { sealedTo, count };
  }

  /**
   * 物理删除过期事件（可选；默认不调，依赖读取时软过滤）。
   * 返回被删除的事件数。
   */
  async pruneExpired(now: number = Date.now()): Promise<number> {
    const all = await this.tail(Number.MAX_SAFE_INTEGER);
    const kept: string[] = [];
    let pruned = 0;

    for (const ev of all) {
      if (isExpired(ev, now)) {
        pruned++;
      } else {
        kept.push(JSON.stringify(ev));
      }
    }

    if (pruned === 0) return 0;

    // 原子重写：tmp + rename
    const fs = await import("node:fs/promises");
    const dir = dirname(this.path);
    const tmpPath = join(dir, `.prune-${randomBytes(4).toString("hex")}.tmp`);
    try {
      await fs.writeFile(tmpPath, kept.join("\n") + (kept.length ? "\n" : ""), "utf-8");
      await rename(tmpPath, this.path);
    } catch (err) {
      try {
        await unlink(tmpPath);
      } catch {
        // ignore
      }
      throw err;
    }

    return pruned;
  }

  /** 计算下一个 archive seq（自增；通过扫 archive 目录实现） */
  private async nextSeq(): Promise<number> {
    let max = 0;
    try {
      const fs = await import("node:fs/promises");
      const files = await fs.readdir(this.archiveDir);
      for (const f of files) {
        const m = f.match(new RegExp(`^${this.runId}\\.(\\d+)\\.jsonl$`));
        if (m) {
          const n = parseInt(m[1], 10);
          if (n > max) max = n;
        }
      }
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
    return max + 1;
  }
}

/** 生成事件 id：sig-<ts>-<rand> */
function generateId(): string {
  return `sig-${Date.now()}-${randomBytes(ID_RANDOM_BYTES).toString("hex")}`;
}
