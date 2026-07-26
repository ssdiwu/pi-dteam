import { truncateToWidth, visibleWidth } from "@earendil-works/pi-tui";
import { THINKING_LEVELS, TIERS, type ThinkingLevel, type Tier, type TierModelRoutes } from "../types/dispatch.js";
import { parseModelCandidate } from "../session/model-candidate.js";
import type { Translate } from "./i18n.js";

export interface CandidateDraft {
  model: string;
  thinking?: ThinkingLevel;
}

export type TierDrafts = Record<Tier, CandidateDraft[]>;

export interface CatalogModel {
  ref: string;
  label: string;
}

export function createTierDrafts(routes: TierModelRoutes): TierDrafts {
  return Object.fromEntries(TIERS.map((tier) => [tier, candidatesForRoute(routes[tier])])) as TierDrafts;
}

export function serializeTierDrafts(drafts: TierDrafts): Record<Tier, string[]> {
  return Object.fromEntries(TIERS.map((tier) => [tier, drafts[tier].map(formatCandidate)])) as Record<Tier, string[]>;
}

export function formatCandidate(candidate: CandidateDraft): string {
  return candidate.thinking ? `${candidate.model}:${candidate.thinking}` : candidate.model;
}

export function cycleCandidateThinking(candidate: CandidateDraft): CandidateDraft {
  const levels: Array<ThinkingLevel | undefined> = [undefined, ...THINKING_LEVELS];
  const index = levels.indexOf(candidate.thinking);
  return { ...candidate, thinking: levels[(index + 1) % levels.length] };
}

export function moveCandidate(candidates: CandidateDraft[], index: number, direction: -1 | 1): CandidateDraft[] {
  const target = index + direction;
  if (index < 0 || target < 0 || index >= candidates.length || target >= candidates.length) return candidates;
  const next = [...candidates];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/** 只消费 Pi 已完成认证解析的模型，避免把注册表全量目录误当可用候选。 */
export async function catalogModels(modelRegistry: any): Promise<CatalogModel[]> {
  const models = typeof modelRegistry?.getAvailable === "function" ? await modelRegistry.getAvailable() : [];
  const byRef = new Map<string, CatalogModel>();
  for (const model of Array.isArray(models) ? models : []) {
    if (typeof model?.provider !== "string" || typeof model?.id !== "string") continue;
    const ref = `${model.provider}/${model.id}`;
    byRef.set(ref, { ref, label: typeof model.name === "string" && model.name !== model.id ? `${ref} · ${model.name}` : ref });
  }
  return [...byRef.values()].sort((left, right) => left.label.localeCompare(right.label));
}

export function renderModelConfig(drafts: TierDrafts, selectedTier: Tier, dirty: boolean, width: number, t: Translate, tabs = ""): string[] {
  const lines = [...(tabs ? [tabs, ""] : []), t("models.global"), ""];
  for (const tier of TIERS) {
    const marker = tier === selectedTier ? "▶" : " ";
    const candidates = drafts[tier].map((candidate, index) => `${index + 1}. ${formatCandidate(candidate)}`).join("  →  ") || t("models.empty");
    lines.push(`${marker} ${tier} · ${candidates}`);
  }
  lines.push("", t(dirty ? "models.controls.dirty" : "models.controls.clean"));
  return frame(lines, t("models.title"), width);
}

export function renderTierEditor(tier: Tier, candidates: CandidateDraft[], selected: number, width: number, t: Translate, tabs = ""): string[] {
  const lines = [...(tabs ? [tabs, ""] : []), ...candidates.map((candidate, index) => `${index === selected ? "▶" : " "} ${index + 1}. ${candidate.model} · ${candidate.thinking ?? t("models.defaultThinking")}`)];
  lines.push("", t("models.controls.editor"));
  return frame(lines, `${t("models.editorTitle", { tier })}`, width);
}

export function renderCatalog(models: CatalogModel[], selected: number, filter: string, width: number, t: Translate, tabs = ""): string[] {
  const matching = filter ? models.filter((model) => model.label.toLowerCase().includes(filter.toLowerCase())) : models;
  const safeSelected = Math.max(0, Math.min(selected, Math.max(0, matching.length - 1)));
  const start = Math.min(Math.max(0, safeSelected - 11), Math.max(0, matching.length - 12));
  const lines = [...(tabs ? [tabs, ""] : []), ...matching.slice(start, start + 12).map((model, index) => `${start + index === safeSelected ? "▶" : " "} ${model.label}`)];
  if (!matching.length) lines.push(t("models.noMatch"));
  lines.push("", t("models.catalogCount", { count: matching.length, total: models.length }), t("models.controls.catalog"));
  return frame(lines, t("models.catalogTitle", { filter: filter || t("models.all") }), width);
}

function candidatesForRoute(route: TierModelRoutes[Tier]): CandidateDraft[] {
  return [route?.primary, ...(route?.fallbackModels ?? [])]
    .filter((candidate): candidate is string => typeof candidate === "string")
    .map((candidate) => {
      const parsed = parseModelCandidate(candidate);
      return { model: parsed.modelStr, thinking: parsed.thinkingLevel };
    });
}

function frame(lines: string[], title: string, width: number): string[] {
  const innerWidth = Math.max(1, Math.floor(width));
  if (innerWidth === 1) return ["│"];
  const bodyWidth = innerWidth - 2;
  const titleText = truncateToWidth(` ${title} `, bodyWidth);
  const titlePadding = Math.max(0, innerWidth - visibleWidth(titleText) - 2);
  const top = `╭${"─".repeat(Math.floor(titlePadding / 2))}${titleText}${"─".repeat(Math.ceil(titlePadding / 2))}╮`;
  const body = lines.map((line) => {
    const content = truncateToWidth(line.replace(/\r?\n/g, " ↵ "), bodyWidth);
    return `│${content}${" ".repeat(Math.max(0, bodyWidth - visibleWidth(content)))}│`;
  });
  return [top, ...body, `╰${"─".repeat(Math.max(0, innerWidth - 2))}╯`];
}
