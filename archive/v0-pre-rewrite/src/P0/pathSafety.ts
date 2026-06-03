import { isAbsolute, relative, resolve } from "node:path";

export function safeFilenamePart(input: string, fallback = "item"): string {
  const normalized = input
    .normalize("NFKC")
    .trim()
    .replace(/[\\/\0<>:"|?*\x00-\x1F]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);

  return normalized || fallback;
}

export function assertInside(baseDir: string, targetPath: string): void {
  const relativePath = relative(baseDir, targetPath);
  if (relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))) {
    return;
  }
  throw new Error(`Path escapes allowed directory: ${targetPath}`);
}

export function resolveInside(baseDir: string, inputPath: string): string {
  if (!inputPath || inputPath.includes("\0")) {
    throw new Error("Invalid path");
  }
  if (isAbsolute(inputPath)) {
    throw new Error("Absolute paths are not allowed");
  }

  const base = resolve(baseDir);
  const target = resolve(base, inputPath);
  assertInside(base, target);
  return target;
}

export function resolveDteamMemoryPath(cwd: string, filepath: string): string {
  // 防嵌套：filepath 只能传文件名/子路径（如 "session.json" 或 "team/foo.json"），
  // 不能包含 ".dteam/memory" 前缀——因为工具会原样拼到 baseDir 下，
  // 传 ".dteam/memory/xxx" 会产出 <cwd>/.dteam/memory/.dteam/memory/xxx 嵌套路径。
  // 检出后直接报错，避免静默产生错误目录。
  if (/(?:^|\/)(?:\.dteam|memory)(?:\/|$)/i.test(filepath)) {
    throw new Error(
      `Memory filepath must not contain ".dteam" or "memory" segments (got: ${filepath}). ` +
        `Pass a bare filename or a sub-path inside .dteam/memory, e.g. "session.json".`,
    );
  }
  const target = resolveInside(resolve(cwd, ".dteam", "memory"), filepath);
  if (!target.endsWith(".json")) {
    throw new Error("Memory file must use .json extension");
  }
  return target;
}
