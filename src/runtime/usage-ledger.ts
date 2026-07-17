import { createHash } from "node:crypto";
import { mkdir, open } from "node:fs/promises";
import { join } from "node:path";
import { sanitizeSensitive } from "./sanitize.js";

export const USAGE_LEDGER_VERSION = 1 as const;
export const USAGE_LEDGER_FILENAME = "dteam-usage.jsonl" as const;

export interface UsageLedgerCost {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  total?: number;
}

export interface UsageLedgerUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: number | UsageLedgerCost;
}

/** The input is deliberately open at runtime: provider usage objects often gain fields. */
export interface UsageLedgerEntryInput {
  timestamp?: string | number;
  parentSessionId: string;
  project: string;
  workerId: string;
  requestedTier: string;
  activeTier: string;
  candidateId: string;
  model: string;
  usage: unknown;
}

export interface UsageLedgerRecord {
  version: typeof USAGE_LEDGER_VERSION;
  timestamp: string;
  parentSessionId: string;
  project: string;
  workerId: string;
  requestedTier: string;
  activeTier: string;
  candidateId: string;
  model: string;
  usage: UsageLedgerUsage;
  dedupKey: string;
}

export function usageLedgerPath(agentDir: string): string {
  return join(agentDir, USAGE_LEDGER_FILENAME);
}

export const getUsageLedgerPath = usageLedgerPath;

/** Keep token/cost accounting data numeric and discard provider-specific metadata. */
export function sanitizeUsage(value: unknown): UsageLedgerUsage {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const source = value as Record<string, unknown>;
  const result: UsageLedgerUsage = {};
  for (const key of ["input", "output", "cacheRead", "cacheWrite", "totalTokens"] as const) {
    const item = source[key];
    if (typeof item === "number" && Number.isFinite(item)) result[key] = item;
  }

  const cost = source.cost;
  if (typeof cost === "number" && Number.isFinite(cost)) {
    result.cost = cost;
  } else if (cost && typeof cost === "object" && !Array.isArray(cost)) {
    const costResult: UsageLedgerCost = {};
    const costSource = cost as Record<string, unknown>;
    for (const key of ["input", "output", "cacheRead", "cacheWrite", "total"] as const) {
      const item = costSource[key];
      if (typeof item === "number" && Number.isFinite(item)) costResult[key] = item;
    }
    if (Object.keys(costResult).length > 0) result.cost = costResult;
  }

  return result;
}

export function createUsageLedgerEntry(input: UsageLedgerEntryInput): UsageLedgerRecord {
  const timestamp = typeof input.timestamp === "number" && Number.isFinite(input.timestamp)
    ? new Date(input.timestamp).toISOString()
    : typeof input.timestamp === "string" ? input.timestamp : new Date().toISOString();
  const record: Omit<UsageLedgerRecord, "dedupKey"> = {
    version: USAGE_LEDGER_VERSION,
    timestamp,
    parentSessionId: sanitizeSensitive(input.parentSessionId),
    project: sanitizeSensitive(input.project),
    workerId: sanitizeSensitive(input.workerId),
    requestedTier: sanitizeSensitive(input.requestedTier),
    activeTier: sanitizeSensitive(input.activeTier),
    candidateId: sanitizeSensitive(input.candidateId),
    model: sanitizeSensitive(input.model),
    usage: sanitizeUsage(input.usage),
  };
  return { ...record, dedupKey: hashStableRecord(record) };
}

/** Hash the complete sanitized event so distinct assistant messages are not collapsed. */
export function usageDedupKey(input: UsageLedgerEntryInput | UsageLedgerRecord): string {
  if ("dedupKey" in input) return hashStableRecord(input);
  return hashStableRecord(createUsageLedgerEntry(input));
}

function hashStableRecord(record: Omit<UsageLedgerRecord, "dedupKey"> | UsageLedgerRecord): string {
  const stableRecord: Record<string, unknown> = { ...record };
  delete stableRecord.dedupKey;
  return createHash("sha256").update(stableStringify(stableRecord)).digest("hex");
}

export async function appendUsageLedger(agentDir: string, input: UsageLedgerEntryInput): Promise<UsageLedgerRecord> {
  const record = createUsageLedgerEntry(input);
  const filePath = usageLedgerPath(agentDir);
  await mkdir(agentDir, { recursive: true, mode: 0o700 });
  const file = await open(filePath, "a", 0o600);
  try {
    await file.chmod(0o600);
    await file.appendFile(`${JSON.stringify(record)}\n`, { encoding: "utf8" });
  } finally {
    await file.close();
  }
  return record;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(object[key])}`).join(",")}}`;
}
