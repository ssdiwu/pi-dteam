/**
 * P0-原子层：原子操作
 *
 * atomicCommit — 代码变更 + task 状态变更必须在同一个 git commit 中完成
 * atomicWrite — 写临时文件 → rename（原子替换）
 */

import { writeFile, rename, mkdir, unlink } from "node:fs/promises";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

// ── 原子提交 ──────────────────────────────────────────────────

export interface AtomicCommitOptions {
  cwd: string;
  message: string;
  files: string[];
  taskId?: string;
  taskStage?: string;
}

export interface AtomicCommitResult {
  success: boolean;
  commitHash?: string;
  error?: string;
}

function runGit(args: string, cwd: string): string {
  return execSync(`git ${args}`, {
    cwd,
    encoding: "utf-8",
    timeout: 30_000,
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

function buildCommitMessage(opts: AtomicCommitOptions): string {
  const prefix = opts.taskId ? `[${opts.taskId}] ` : "";
  const header = `${prefix}${opts.message}`;
  const body: string[] = [];

  if (opts.taskStage) {
    body.push(`stage: ${opts.taskStage}`);
  }
  if (opts.files.length > 0) {
    body.push(`files: ${opts.files.join(", ")}`);
  }

  return body.length > 0 ? `${header}\n\n${body.join("\n")}` : header;
}

/**
 * 原子提交：将指定文件 add → commit，返回结果。
 *
 * 流程：
 * 1. 校验 files 非空
 * 2. `git add` 指定文件
 * 3. 构造 commit message（含 taskId / taskStage / files）
 * 4. `git commit`
 * 5. 返回 commit hash
 *
 * 失败时返回 `{ success: false, error }`，不抛异常。
 */
export function atomicCommit(options: AtomicCommitOptions): AtomicCommitResult {
  const { cwd, files } = options;

  if (!files || files.length === 0) {
    return { success: false, error: "No files to commit" };
  }

  try {
    const quoted = files.map((f) => `"${f}"`).join(" ");
    runGit(`add ${quoted}`, cwd);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `git add failed: ${msg}` };
  }

  const message = buildCommitMessage(options);

  try {
    execSync(`git commit -F -`, {
      cwd,
      input: message,
      encoding: "utf-8",
      timeout: 30_000,
      stdio: ["pipe", "pipe", "pipe"],
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `git commit failed: ${msg}` };
  }

  try {
    const hash = runGit("rev-parse HEAD", cwd);
    return { success: true, commitHash: hash };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { success: false, error: `git rev-parse failed: ${msg}` };
  }
}

// ── 原子写入 ──────────────────────────────────────────────────

/**
 * 原子写入文件。
 *
 * 流程：
 * 1. 确保目标目录存在
 * 2. 将内容写到同目录的临时文件（.tmp-<random>）
 * 3. rename 临时文件到目标路径（文件系统级原子操作）
 * 4. 若 rename 失败（跨文件系统，如 Docker volume），回退到直接 writeFile
 *
 * 保证：函数 resolve 时文件内容一定等于传入的 content；
 *       函数 reject 时目标文件要么保持原样，要么不存在（新文件场景）。
 */
export async function atomicWrite(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpName = `.tmp-${randomBytes(8).toString("hex")}`;
  const tmpPath = join(dir, tmpName);

  try {
    await writeFile(tmpPath, content, "utf-8");

    try {
      await rename(tmpPath, filePath);
    } catch (renameErr: unknown) {
      const code = (renameErr as NodeJS.ErrnoException).code;
      if (code === "ENOTSUP" || code === "EXDEV") {
        await writeFile(filePath, content, "utf-8");
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    try {
      await unlink(tmpPath);
    } catch {
      // ignore cleanup errors
    }
    throw err;
  }
}

/**
 * Promise 队列，保证异步操作顺序执行。
 */
export class MutationQueue {
  private chain: Promise<void> = Promise.resolve();

  enqueue(fn: () => Promise<void>): Promise<void> {
    const next = this.chain.then(() => fn(), () => fn());
    this.chain = next.catch(() => {});
    return next;
  }
}
