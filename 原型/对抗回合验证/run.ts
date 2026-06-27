/**
 * 对抗回合验证 —— 主入口。
 *
 * 用真实模型跑一个合议单元，验证 ADR 0007 积分制的收敛性 / 打分一致性 / 方差 / token。
 *
 * 运行：
 *   bun run run.ts "<goal>"
 *   bun run run.ts "<goal>" --mock
 *
 * 模型调用：spawn `pi -p --model X --append-system-prompt ...`，每个角色独立子进程（天然 fresh）。
 */

import { spawnSync, spawn } from "node:child_process";
import { writeFileSync, appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import {
  initUnit, startNextRound, setEvidence, setProposal, toCritique, adjudicate,
  parseTier, WIN_SCORE, MIN_ROUNDS, MAX_ROUNDS,
  type UnitState, type ScoreTier,
} from "./scoring.ts";

// ─── 配置：design 差异化（模型维度 + prompt 偏好维度）──────────────────────
// 从 pi --list-models 选三个不同族，制造方差。单模型用户可改成都用同一模型，
// 只靠 stance 差异（验证 prompt 维度够不够）。
const DESIGNS = [
  { id: "D1", model: "zai-coding-cn/glm-5.2", stance: "稳健派：重风险控制、最小改动、向后兼容；优先复用现有机制，不新建抽象" },
  { id: "D2", model: "zai-coding-cn/glm-5.2", stance: "激进派：敢于重写、追求突破性方案；推翻现状，从底层重设计" },
  { id: "D3", model: "zai-coding-cn/glm-5.2", stance: "务实派：重落地成本、工期、可维护性；能跑就别折腾" },
];
// 全部角色用同一模型 glm-5.2——验证 ADR 0007「单模型也可」：靠 prompt 偏好制造方差，不靠多模型。
// 排除「模型差异」这个变量，直验积分制本身的根基。
const ORCHESTRATOR_MODEL = "zai-coding-cn/glm-5.2";

// ─── 模型调用层 ──────────────────────────────────────────────────────────

interface CallOpts { model: string; systemPrompt?: string; user: string; mock?: boolean; tag: string }

async function callLLM({ model, systemPrompt, user, mock, tag }: CallOpts): Promise<{ text: string; ms: number }> {
  if (mock) return mockCall(tag, user);
  const t0 = Date.now();
  const args = ["-p", "--model", model];
  if (systemPrompt) args.push("--append-system-prompt", systemPrompt);
  args.push(user);
  // 用异步 spawn + Promise，让多个调用真正并行（spawnSync 会阻塞整个 node 进程导致串行）
  const proc = spawn("pi", args, { stdio: ["pipe", "pipe", "pipe"] });
  let out = "";
  let errbuf = "";
  proc.stdout.on("data", d => { out += d.toString(); });
  proc.stderr.on("data", d => { errbuf += d.toString(); });
  return new Promise((resolve) => {
    const to = setTimeout(() => { try { proc.kill("SIGKILL"); } catch {}; resolve({ text: "(超时90s)", ms: Date.now()-t0 }); }, 90000);
    proc.on("close", () => {
      clearTimeout(to);
      const text = out.trim() || `(空输出 stderr=${errbuf.slice(0, 200)})`;
      resolve({ text, ms: Date.now()-t0 });
    });
    proc.on("error", () => { clearTimeout(to); resolve({ text: `(调用失败)`, ms: Date.now()-t0 }); });
  });
}

// ─── mock：确定性模拟，验证状态机流转（不调真模型）─────────────────────────
function mockCall(tag: string, user: string): { text: string; ms: number } {
  if (tag.startsWith("design")) return { text: `[mock方案:${tag}] ${user.slice(0, 30)}… 偏好注入`, ms: 5 };
  if (tag.startsWith("close")) {
    // 从 tag close-round=N 提取轮次；第 3 轮起让 D1 大幅胜出，模拟收敛
    const rm = /round=(\d+)/.exec(tag);
    const round = rm ? Number(rm[1]) : 1;
    const map: Record<string, string> = round >= 3
      ? { D1: "big_win", D2: "none", D3: "tie_or_minor" }
      : { D1: "tie_or_minor", D2: "tie_or_minor", D3: "none" };
    return { text: JSON.stringify(map) + "|mock理由", ms: 5 };
  }
  return { text: `[mock:${tag}]`, ms: 5 };
}

// ─── 角色调用封装 ────────────────────────────────────────────────────────

async function explore(goal: string, round: number, mock?: boolean) {
  return callLLM({
    model: ORCHESTRATOR_MODEL, mock, tag: "explore",
    systemPrompt: "你是证据方。只列事实、约束、风险点，不提方案、不判断。限120字。",
    user: `目标：${goal}\n给出事实/约束摘要：`,
  });
}

async function design(id: string, model: string, stance: string, goal: string, evidence: string, feedback: string | null, mock?: boolean) {
  const fbLine = feedback ? `\n上一轮裁决反馈（摘要，非对手原文）：${feedback}` : "";
  return callLLM({
    model, mock, tag: `design-${id}`,
    systemPrompt: `你是方案主张方，立场：${stance}。提一个完整方案，亮明关键权衡。限120字。${fbLine ? "根据反馈改进。" : ""}`,
    user: `目标：${goal}\n事实：${evidence ?? "(无)"}${fbLine}\n给出方案：`,
  });
}

// build + check 合并：一次调用同时给可行性质疑 + 风险质疑，减一轮调用数
async function critique(goal: string, proposals: Record<string, string>, mock?: boolean) {
  return callLLM({
    model: ORCHESTRATOR_MODEL, mock, tag: "critique",
    systemPrompt: "你是反方。对每个方案同时指出：①可行性质疑（实现/成本）②风险/漂移/遗漏。逐个方案各一句。限150字。",
    user: `目标：${goal}\n各方案：\n${fmtProposals(proposals)}\n逐个点评：`,
  });
}

async function runAdjudication(
  goal: string, proposals: Record<string, string>, buildQ: string, checkQ: string,
  round: number, mock?: boolean,
): Promise<{ tiers: Record<string, ScoreTier>; rationale: Record<string, string> }> {
  const ids = Object.keys(proposals);
  const res = await callLLM({
    model: ORCHESTRATOR_MODEL, mock, tag: `close-round=${round}`,
    systemPrompt: `你是独立裁决方（fresh，不知方案出处历史）。读各方案+两路反方质疑，做 selection（选最好的，绝不融合）。
打分档：big_win(大幅胜出) / tie_or_minor(平局或微弱胜出) / none(本轮未胜出)。可多名 tie。
严格只输出一行 JSON：{"D1":"tier","D2":"tier","D3":"tier"}，下一行起写每个方案的分档理由（摘要，不说对手原文）。`,
    user: `目标：${goal}\n\n各方案：\n${fmtProposals(proposals)}\n\nbuild 质疑：${buildQ}\n\ncheck 质疑：${checkQ}\n\n输出 JSON + 理由：`,
  });
  return parseAdjudication(res.text, ids);
}

function parseAdjudication(raw: string, ids: string[]): { tiers: Record<string, ScoreTier>; rationale: Record<string, string> } {
  const m = /\{[^}]*\}/.exec(raw);
  const tiers: Record<string, ScoreTier> = {};
  if (m) {
    try {
      const obj = JSON.parse(m[0]);
      for (const id of ids) tiers[id] = parseTier(String(obj[id] ?? "none"));
    } catch { /* 落到下面默认 */ }
  }
  for (const id of ids) if (!tiers[id]) tiers[id] = "none";
  // 理由：JSON 后面的文本，按 id 切分（粗略）
  const rest = raw.replace(/^\s*\{[^}]*\}/, "");
  const rationale: Record<string, string> = {};
  for (const id of ids) {
    const re = new RegExp(`${id}[：:]\\s*([^\\n]*(?:\\n(?!D\\d[：:])[^\\n]*)*)`);
    const mm = re.exec(rest);
    rationale[id] = mm ? mm[1].trim().slice(0, 120) : "(理由解析失败)";
  }
  return { tiers, rationale };
}

function fmtProposals(p: Record<string, string>): string {
  return Object.entries(p).map(([id, t]) => `### ${id}：\n${t}`).join("\n\n");
}

// ─── TUI：每步打印完整状态 ───────────────────────────────────────────────

const C = { dim: "\x1b[2m", reset: "\x1b[0m", bold: "\x1b[1m", green: "\x1b[32m", yellow: "\x1b[33m", cyan: "\x1b[36m", red: "\x1b[31m", magenta: "\x1b[35m" };

const LOG_PATH = process.env.MOCKUP_LOG ?? "";
function out(line: string) {
  console.log(line);
  if (LOG_PATH) appendFileSync(LOG_PATH, stripAnsi(line) + "\n");
}
function stripAnsi(s: string): string { return s.replace(/\x1b\[[0-9;]*m/g, ""); }
function hr(title: string) { out(`\n──── ${title} ────`); }
function tierColor(t: ScoreTier): string {
  return t === "big_win" ? C.green : t === "tie_or_minor" ? C.yellow : C.red;
}
function bar(score: number): string { return "█".repeat(score) + C.dim + "░".repeat(WIN_SCORE - score) + C.reset; }

function render(state: UnitState, tokenMs: Record<string, number>) {
  hr(`回合 ${state.round} · phase=${state.phase}`);
  out(`目标：${state.goal}`);
  if (state.evidence) out(`证据：${state.evidence!.slice(0, 100)}…`);
  out("");
  for (const d of state.designs) {
    const last = d.history[d.history.length - 1];
    out(`  ${d.id} [${d.model}] (${d.stance})`);
    out(`     分数 ${"█".repeat(d.totalScore)}${"·".repeat(WIN_SCORE - d.totalScore)} ${d.totalScore}/${WIN_SCORE}  本轮:${last ?? "—"}  历程:${d.history.join("/")} | ${d.currentProposal ? d.currentProposal.slice(0, 90) : ""}`);
  }
  const lastRound = state.rounds[state.rounds.length - 1];
  if (lastRound) {
    out("");
    for (const id of Object.keys(lastRound.rationale)) {
      out(`  裁决理由 ${id}：${lastRound.rationale[id]}`);
    }
  }
  const totalMs = Object.values(tokenMs).reduce((a, b) => a + b, 0);
  out(`\n  本步耗时：${(totalMs / 1000).toFixed(1)}s · 角色明细：${Object.entries(tokenMs).map(([k, v]) => `${k}=${(v / 1000).toFixed(1)}s`).join(" ")}`);
  if (state.status !== "running") {
    hr(state.status === "converged" ? `✓ 收敛：${state.winnerId} 胜出` : `⚠ 兜底：${state.winnerId}（max_rounds）`);
  }
}

// ─── 主 loop ─────────────────────────────────────────────────────────────

async function main() {
  const mock = process.argv.includes("--mock");
  const goal = process.argv.find(a => !a.startsWith("-") && a !== process.argv[0] && a !== process.argv[1]);
  if (!goal) { console.error("用法：bun run run.ts \"<goal>\" [--mock]"); process.exit(1); }

  let state = initUnit(goal, DESIGNS);
  out(`dteam 对抗回合验证原型 ${mock ? "(mock 模式)" : "(真实模型)"}`);
  out(`收敛条件：先到 ${WIN_SCORE} 分 且 ≥ ${MIN_ROUNDS} 轮；兜底 ${MAX_ROUNDS} 轮`);

  const stepMs: Record<string, number> = {};

  while (state.status === "running") {
    state = startNextRound(state);
    for (const k of Object.keys(stepMs)) stepMs[k] = 0;

    // ① 证据（仅第 1 轮跑；后续轮复用，省一次调用）
    if (state.round === 1) {
      const ev = await explore(goal, state.round, mock); stepMs.explore = ev.ms;
      state = setEvidence(state, ev.text);
    }

    // ② 主张：N design 并行（evidence 用 state.evidence，第 2+ 轮复用第 1 轮证据）
    const evidenceText = state.evidence ?? "(无)";
    const propRes = await Promise.all(state.designs.map(d => {
      const fb = state.rounds[state.rounds.length - 1]?.rationale[d.id] ?? null;
      return design(d.id, d.model, d.stance, goal, evidenceText, fb, mock).then(r => {
        stepMs[`design-${d.id}`] = r.ms;
        return [d.id, r.text] as const;
      });
    }));
    for (const [id, t] of propRes) state = setProposal(state, id, t);
    state = toCritique(state);
    render(state, stepMs);

    // ③ 反方：build+check 合并一次调用
    const proposals: Record<string, string> = {};
    for (const d of state.designs) proposals[d.id] = d.currentProposal ?? "";
    const cr = await critique(goal, proposals, mock); stepMs.critique = cr.ms;

    // ④ 裁决（fresh）
    const adj = await runAdjudication(goal, proposals, cr.text, "", state.round, mock); stepMs.close = 0;
    state = adjudicate(state, adj.tiers, adj.rationale);
    render(state, stepMs);
  }

  // verdict
  hr("verdict");
  out(`总轮数：${state.round}（${MIN_ROUNDS}~${MAX_ROUNDS} 区间）`);
  out(`胜出：${state.winnerId}（累计 ${state.designs.find(d => d.id === state.winnerId)?.totalScore}/${WIN_SCORE}）`);
  out("分数曲线：");
  for (const d of state.designs) {
    out(`  ${d.id}：${d.history.map(h => h === "big_win" ? "2" : h === "tie_or_minor" ? "1" : "0").join(" ")} = ${d.totalScore}`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
