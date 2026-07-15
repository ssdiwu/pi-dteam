import { DTEAM_CONFIG } from "../config.js";

export function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function sanitizeSensitive(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+ KEY-----[\s\S]*?-----END [^-]+ KEY-----/gi, "[REDACTED_KEY]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_\-]{16,}|github_pat_[A-Za-z0-9_\-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED_SECRET]")
    .replace(/(\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1[REDACTED_SECRET]$3")
    .replace(/((?:api[_-]?key|secret|token|password|authorization|database[_-]?url|connection[_-]?string)\s*[:=]\s*)([\"']?)[^\s,;]+/gi, "$1$2[REDACTED_SECRET]");
}

export function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return truncate(sanitizeSensitive(value), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeUnknown(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key, sanitizeUnknown(item, depth + 1)]));
  return value;
}
