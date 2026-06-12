import { DTEAM_CONFIG } from "../config.js";

export function isSharedFile(file: string, patterns = DTEAM_CONFIG.scheduler.sharedFilePatterns): boolean {
  const normalized = file.split("\\").join("/");
  return patterns.some((pattern) => matchesPattern(normalized, pattern));
}

export function sharedFiles(files: string[], patterns = DTEAM_CONFIG.scheduler.sharedFilePatterns): string[] {
  return [...new Set(files.filter((file) => isSharedFile(file, patterns)))];
}

function matchesPattern(file: string, pattern: string): boolean {
  const normalizedPattern = pattern.split("\\").join("/");
  if (normalizedPattern.includes("*")) return wildcardToRegExp(normalizedPattern).test(file)
    || wildcardToRegExp(normalizedPattern).test(basename(file));
  return file === normalizedPattern;
}

function wildcardToRegExp(pattern: string): RegExp {
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

function basename(file: string): string {
  const parts = file.split("/");
  return parts[parts.length - 1] ?? file;
}
