/**
 * 对抗回合积分 reducer —— 纯逻辑，可移植可吸收。
 * 不依赖任何模型调用，只管状态流转和算术。
 *
 * 状态机：一个合议单元走多轮，每轮各 design 出方案 → 反方质疑 → close 打分 → 累计。
 * 收敛：某 design 累计 ≥ WIN_SCORE 且 轮数 ≥ MIN_ROUNDS。
 */

export const WIN_SCORE = 5;
export const MIN_ROUNDS = 3;
export const MAX_ROUNDS = 8; // 兜底，防永不收敛

/** 单轮某 design 的得分档（来自 close 裁决） */
export type ScoreTier = "big_win" | "tie_or_minor" | "none";

export const TIER_POINTS: Record<ScoreTier, number> = {
  big_win: 2,
  tie_or_minor: 1,
  none: 0,
};

export interface DesignState {
  /** 标识：模型族+偏好，便于观察方差来源 */
  id: string;
  model: string;
  stance: string; // prompt 偏好
  totalScore: number;
  /** 每轮得分档，便于画分数曲线 */
  history: ScoreTier[];
  /** 当前轮方案（文本） */
  currentProposal: string | null;
}

export interface RoundScore {
  round: number;
  /** 每个 design 本轮的得分档 */
  tiers: Record<string, ScoreTier>;
  /** close 给的逐条理由（每 design 一段，不转对手原文） */
  rationale: Record<string, string>;
}

export type Phase = "evidence" | "propose" | "critique" | "adjudicate" | "converged" | "max_rounds";

export interface UnitState {
  goal: string;
  round: number;
  phase: Phase;
  designs: DesignState[];
  rounds: RoundScore[];
  /** explore 供的事实摘要（每轮可更新） */
  evidence: string | null;
  status: "running" | "converged" | "max_rounds";
  winnerId: string | null;
}

export function initUnit(goal: string, designs: Omit<DesignState, "totalScore" | "history" | "currentProposal">[]): UnitState {
  return {
    goal,
    round: 0,
    phase: "evidence",
    designs: designs.map(d => ({ ...d, totalScore: 0, history: [], currentProposal: null })),
    rounds: [],
    evidence: null,
    status: "running",
    winnerId: null,
  };
}

/** 进入下一轮：清空当前方案、phase 回到 evidence */
export function startNextRound(state: UnitState): UnitState {
  return {
    ...state,
    round: state.round + 1,
    phase: "evidence",
    designs: state.designs.map(d => ({ ...d, currentProposal: null })),
  };
}

/** 记录 explore 证据 */
export function setEvidence(state: UnitState, evidence: string): UnitState {
  return { ...state, evidence, phase: "propose" };
}

/** 某 design 提交方案 */
export function setProposal(state: UnitState, designId: string, proposal: string): UnitState {
  return {
    ...state,
    designs: state.designs.map(d => (d.id === designId ? { ...d, currentProposal: proposal } : d)),
  };
}

/** 所有 design 都提交后，进入反方质疑 */
export function toCritique(state: UnitState): UnitState {
  return { ...state, phase: "critique" };
}

/** close 打分（核心 reducer）。输入本轮各 design 的得分档 + 理由，累计并判收敛 */
export function adjudicate(state: UnitState, tiers: Record<string, ScoreTier>, rationale: Record<string, string>): UnitState {
  const roundScore: RoundScore = { round: state.round, tiers, rationale };

  const designs = state.designs.map(d => {
    const tier = tiers[d.id] ?? "none";
    return {
      ...d,
      totalScore: Math.min(WIN_SCORE, d.totalScore + TIER_POINTS[tier]),
      history: [...d.history, tier],
    };
  });

  // 收敛条件：某 design 累计 ≥ WIN_SCORE 且 轮数 ≥ MIN_ROUNDS
  const reachedMin = state.round >= MIN_ROUNDS;
  const winners = designs.filter(d => d.totalScore >= WIN_SCORE);

  let status: UnitState["status"] = "running";
  let phase: Phase = "evidence";
  let winnerId: string | null = null;

  if (reachedMin && winners.length > 0) {
    status = "converged";
    phase = "converged";
    // 并列取累计分最高；同分取第一个（确定性）
    winnerId = winners.sort((a, b) => b.totalScore - a.totalScore)[0].id;
  } else if (state.round >= MAX_ROUNDS) {
    // 兜底：取累计最高
    status = "max_rounds";
    phase = "max_rounds";
    winnerId = designs.slice().sort((a, b) => b.totalScore - a.totalScore)[0].id;
  }

  return {
    ...state,
    designs,
    rounds: [...state.rounds, roundScore],
    status,
    phase,
    winnerId,
  };
}

/** 从 close 的"胜出判定"文本解析成 tier（mock/真实都走这里）*/
export function parseTier(raw: string): ScoreTier {
  const s = raw.trim().toLowerCase();
  if (s.startsWith("big_win") || s.includes("大幅")) return "big_win";
  if (s.startsWith("tie_or_minor") || s.includes("微弱") || s.includes("平局") || s.includes("各有千秋")) return "tie_or_minor";
  return "none";
}
