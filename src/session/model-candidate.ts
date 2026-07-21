import { THINKING_LEVELS, type ThinkingLevel } from "../types/dispatch.js";

export interface ParsedModelCandidate {
  modelStr: string;
  thinkingLevel?: ThinkingLevel;
}

/** Parses the optional `:thinking` suffix without changing the configured model reference. */
export function parseModelCandidate(candidate: string): ParsedModelCandidate {
  const separator = candidate.lastIndexOf(":");
  const suffix = separator > candidate.indexOf("/") ? candidate.slice(separator + 1) : "";
  if (suffix && (THINKING_LEVELS as readonly string[]).includes(suffix)) {
    return { modelStr: candidate.slice(0, separator), thinkingLevel: suffix as ThinkingLevel };
  }
  return { modelStr: candidate };
}

export function isModelReference(candidate: string): boolean {
  const slash = candidate.indexOf("/");
  return slash > 0 && slash < candidate.length - 1 && !candidate.includes(" ");
}
