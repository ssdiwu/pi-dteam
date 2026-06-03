import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  isGitRepo,
  getWorktreeBranch,
  getWorktreePath,
  createWorktree,
  cleanupWorktree,
  listWorktrees,
} from "../../src/P1/worktree.js";

// Mock child_process
const mockExecSync = vi.fn();
vi.mock("node:child_process", () => ({
  execSync: (...args: any[]) => mockExecSync(...args),
}));

// Mock fs
const mockExistsSync = vi.fn();
const mockMkdirSync = vi.fn();
vi.mock("node:fs", () => ({
  existsSync: (...args: any[]) => mockExistsSync(...args),
  mkdirSync: (...args: any[]) => mockMkdirSync(...args),
}));

describe("worktree", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("isGitRepo", () => {
    it("should return true for git repo", () => {
      mockExecSync.mockReturnValue("");
      expect(isGitRepo("/test")).toBe(true);
    });

    it("should return false for non-git repo", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not a git repo");
      });
      expect(isGitRepo("/test")).toBe(false);
    });
  });

  describe("getWorktreeBranch", () => {
    it("should generate correct branch name", () => {
      expect(getWorktreeBranch("worker-123")).toBe("dteam/worker-123");
    });
  });

  describe("getWorktreePath", () => {
    it("should generate correct path", () => {
      expect(getWorktreePath("/project", "worker-123")).toBe(
        "/project/.dteam/worktrees/worker-123"
      );
    });
  });

  describe("createWorktree", () => {
    it("should create worktree successfully", () => {
      mockExistsSync.mockReturnValue(false);
      mockExecSync.mockReturnValue("");

      const result = createWorktree({
        workerId: "worker-123",
        cwd: "/project",
      });

      expect(result.created).toBe(true);
      expect(result.branch).toBe("dteam/worker-123");
      expect(mockMkdirSync).toHaveBeenCalled();
    });

    it("should return existing worktree", () => {
      mockExistsSync.mockReturnValue(true);

      const result = createWorktree({
        workerId: "worker-123",
        cwd: "/project",
      });

      expect(result.created).toBe(false);
    });

    it("should throw for non-git repo", () => {
      mockExecSync.mockImplementation(() => {
        throw new Error("not a git repo");
      });

      expect(() =>
        createWorktree({ workerId: "worker-123", cwd: "/project" })
      ).toThrow("Not a git repository");
    });
  });

  describe("cleanupWorktree", () => {
    it("should cleanup worktree successfully", () => {
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue("");

      const result = cleanupWorktree("/project", "worker-123");
      expect(result).toBe(true);
    });

    it("should return false for non-existing worktree", () => {
      mockExistsSync.mockReturnValue(false);

      const result = cleanupWorktree("/project", "worker-123");
      expect(result).toBe(false);
    });
  });

  describe("listWorktrees", () => {
    it("should list worktrees", () => {
      mockExistsSync.mockReturnValue(true);
      mockExecSync.mockReturnValue(
        "worktree /project/.dteam/worktrees/worker-123\nHEAD abc123\nbranch refs/heads/dteam/worker-123\n"
      );

      const result = listWorktrees("/project");
      expect(result).toHaveLength(1);
      expect(result[0]).toContain("worker-123");
    });

    it("should return empty for no worktrees", () => {
      mockExistsSync.mockReturnValue(false);

      const result = listWorktrees("/project");
      expect(result).toHaveLength(0);
    });
  });
});
