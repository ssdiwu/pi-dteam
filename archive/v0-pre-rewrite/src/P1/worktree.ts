/**
 * P1-worktree：Git Worktree 隔离
 *
 * 为并行 worker 提供文件级隔离，避免冲突。
 * 每个 worker 在独立的 worktree 中执行，完成后可选清理。
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

// ── 类型定义 ──────────────────────────────────────────────────

export interface WorktreeInfo {
  /** worktree 路径 */
  path: string;
  /** 分支名 */
  branch: string;
  /** 是否已创建 */
  created: boolean;
}

export interface WorktreeOptions {
  /** worker ID，用于命名分支和路径 */
  workerId: string;
  /** 项目根目录（git 仓库） */
  cwd: string;
  /** 是否在 worker 完成后自动清理 */
  autoCleanup?: boolean;
}

// ── 工具函数 ──────────────────────────────────────────────────

/**
 * 检查目录是否是 git 仓库
 */
export function isGitRepo(cwd: string): boolean {
  try {
    execSync("git rev-parse --is-inside-work-tree", { cwd, stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * 生成 worktree 分支名
 */
export function getWorktreeBranch(workerId: string): string {
  return `dteam/${workerId}`;
}

/**
 * 生成 worktree 路径
 */
export function getWorktreePath(cwd: string, workerId: string): string {
  return join(cwd, ".dteam", "worktrees", workerId);
}

// ── 核心操作 ──────────────────────────────────────────────────

/**
 * 创建 worktree
 * @returns WorktreeInfo
 */
export function createWorktree(options: WorktreeOptions): WorktreeInfo {
  const { workerId, cwd } = options;
  const branch = getWorktreeBranch(workerId);
  const worktreePath = getWorktreePath(cwd, workerId);

  // 检查是否是 git 仓库
  if (!isGitRepo(cwd)) {
    throw new Error(`Not a git repository: ${cwd}`);
  }

  // 创建 worktrees 目录
  const worktreesDir = join(cwd, ".dteam", "worktrees");
  if (!existsSync(worktreesDir)) {
    mkdirSync(worktreesDir, { recursive: true });
  }

  // 检查 worktree 是否已存在
  if (existsSync(worktreePath)) {
    console.warn(`[dteam.worktree] Worktree already exists: ${worktreePath}`);
    return { path: worktreePath, branch, created: false };
  }

  // 创建 worktree
  try {
    execSync(`git worktree add -b ${branch} ${worktreePath}`, {
      cwd,
      stdio: "ignore",
    });
    console.log(`[dteam.worktree] Created worktree: ${worktreePath} (branch: ${branch})`);
    return { path: worktreePath, branch, created: true };
  } catch (error) {
    throw new Error(`Failed to create worktree: ${error}`);
  }
}

/**
 * 清理 worktree
 */
export function cleanupWorktree(cwd: string, workerId: string): boolean {
  const worktreePath = getWorktreePath(cwd, workerId);
  const branch = getWorktreeBranch(workerId);

  if (!existsSync(worktreePath)) {
    console.warn(`[dteam.worktree] Worktree not found: ${worktreePath}`);
    return false;
  }

  try {
    // 删除 worktree
    execSync(`git worktree remove ${worktreePath} --force`, {
      cwd,
      stdio: "ignore",
    });

    // 删除分支
    try {
      execSync(`git branch -D ${branch}`, { cwd, stdio: "ignore" });
    } catch {
      // 分支可能不存在，忽略错误
    }

    console.log(`[dteam.worktree] Cleaned up worktree: ${worktreePath}`);
    return true;
  } catch (error) {
    console.error(`[dteam.worktree] Failed to cleanup worktree: ${error}`);
    return false;
  }
}

/**
 * 列出所有 dteam worktrees
 */
export function listWorktrees(cwd: string): string[] {
  const worktreesDir = join(cwd, ".dteam", "worktrees");
  if (!existsSync(worktreesDir)) {
    return [];
  }

  try {
    const output = execSync("git worktree list --porcelain", {
      cwd,
      encoding: "utf-8",
    });

    const worktrees: string[] = [];
    for (const line of output.split("\n")) {
      if (line.startsWith("worktree ")) {
        const path = line.slice(9);
        if (path.includes(".dteam/worktrees/")) {
          worktrees.push(path);
        }
      }
    }
    return worktrees;
  } catch {
    return [];
  }
}
