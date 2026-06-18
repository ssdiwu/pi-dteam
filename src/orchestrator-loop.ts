/**
 * Orchestrator Loop（编排循环）— 0.6.0 主循环
 *
 * 与旧 orchestrator.ts（Plan→Execute→Report 二维编排）并存。
 * 决策依据：ADR 0005
 *  - 第 17 条：LLM-Driven Orchestration，每轮一次 LLM 调用输出 OrchestratorDecision
 *  - 第 8 条：无预先 Task Plan，召唤轨迹（summonTrail）即计划
 *  - 第 14 条：强制 check 收口（Completion Gate）
 *
 * 当前 Phase 1：先串行召唤（Phase 3 加并发）。
 *
 * 结构：
 *   读 SignalStore 快照 → Orchestrator LLM 决策 →
 *     summon → leaf.execute() → 结果+信号入 summonTrail → 继续
 *     check  → leaf.execute("check") → parseCheckResult →
 *                passed → done / reject → 继续（maxCheckRetries 上限）
 *     done   → 收口返回
 *     fail   → 标记失败返回
 */

import { createWorkerSession, pickAvailableModel } from "./session.js";
import { SignalStore } from "./signals/signal-store.js";
import { buildOrchestratorSystemPrompt, buildOrchestratorUserPrompt, parseOrchestratorDecision } from "./orchestrator-loop/decision.js";
import { parseCheckResult } from "./orchestrator-loop/check-gate.js";
import { AdaptiveConcurrency, DEFAULT_CONCURRENCY_CONFIG, type ConcurrencyConfig } from "./orchestrator-loop/concurrency.js";
import { resolveModelWithFallback, type ModelOverrides, type FallbackModels } from "./orchestrator-loop/model-routing.js";
import { extractLastText } from "./leaf/extract.js";
import { nextWorkerId } from "./leaf/worker-id.js";
import { DTEAM_CONFIG } from "./config.js";
import {
  DEFAULT_LOOP_CONFIG,
  LOOP_TYPES_VERSION,
  type DteamResult6,
  type SummonStep,
  type OrchestratorDecision,
  type CheckResult,
  type LoopConfig,
  type ISignalStore,
} from "./types/loop.js";
import type { RoleName } from "./types/role.js";
import type { Signal } from "./tools.js";

/** Orchestrator Loop 运行时需要的上下文（Phase 1 最小集，后续 Phase 扩展） */
export interface LoopContext {
  cwd: string;
  modelRegistry: any;
  model?: { provider: string; id: string };
  /** Orchestrator LLM 用的模型字符串（不传则用 pickAvailableModel） */
  orchestratorModel?: string;
  /** 可选：传给 worker 的工具白名单（主 LLM 调用时传入） */
  availableTools?: string[];
  /** 0.6.0 Phase 3：per-role 主模型覆盖（Multi-Provider Routing） */
  modelOverrides?: ModelOverrides;
  /** 0.6.0 Phase 3：per-role fallback 链（Multi-Provider Routing） */
  fallbackModels?: FallbackModels;
  /** 0.6.0 Phase 3：自适应并发配置（不传走默认） */
  concurrency?: ConcurrencyConfig;
  [k: string]: any;
}

/**
 * 运行一次 Orchestrator Loop。
 *
 * @param goal 目标
 * @param ctx 上下文
 * @param config loop 配置（不传走 DEFAULT_LOOP_CONFIG）
 */
export async function runLoop(
  goal: string,
  ctx: LoopContext,
  config: LoopConfig = DEFAULT_LOOP_CONFIG,
): Promise<DteamResult6> {
  const goalId = `goal-${Date.now().toString(36)}`;
  const store = new SignalStore(goalId);
  const summonTrail: SummonStep[] = [];
  const startedAt = Date.now();
  let checkRound = 0;
  let checkConclusion: CheckResult | null = null;
  // 0.6.0 Phase 3：自适应并发控制器
  const concurrencyCtrl = new AdaptiveConcurrency(ctx.concurrency ?? DEFAULT_CONCURRENCY_CONFIG);

  try {
    // 主循环：每轮一次 Orchestrator LLM 决策
    for (let round = 1; round <= config.maxRounds; round++) {
      const decision = await decide(goal, store, summonTrail, checkRound, ctx);

      if (decision.type === "summon") {
        // 0.6.0 Phase 3：parallel>1 时并发召唤，受 AdaptiveConcurrency 调控
        const count = decision.parallel ?? 1;
        if (count > 1) {
          const steps = await summonParallel(decision.role, decision.task, count, goal, ctx, store, concurrencyCtrl, decision.tools);
          summonTrail.push(...steps);
        } else {
          const step = await summon(decision.role, decision.task, goal, ctx, store, decision.tools);
          summonTrail.push(step);
        }
        continue;
      }

      if (decision.type === "check") {
        checkRound += 1;
        const checkStep = await summon("check", decision.task, goal, ctx, store, decision.tools);
        summonTrail.push(checkStep);
        const result = parseCheckResult(checkStep.result ?? "", checkRound);
        checkConclusion = result;

        if (result.passed) {
          // check 通过 → 收口完成
          return finalize("done", goal, summonTrail, store, result, startedAt);
        }

        // check 未通过：检查是否超过最大重试
        if (checkRound >= config.maxCheckRetries) {
          return finalize("failed", goal, summonTrail, store, result, startedAt,
            `check 收口失败：已达最大重试次数 ${config.maxCheckRetries}`);
        }

        // 否则继续 loop，让 Orchestrator 根据问题决定修复方向
        continue;
      }

      if (decision.type === "done") {
        // done 只在 check 通过后合法；若 Orchestrator 跳过 check 直接 done，
        // 视为违规，强制走 check
        if (checkConclusion?.passed) {
          return finalize("done", goal, summonTrail, store, checkConclusion, startedAt);
        }
        // 强制 Completion Gate：忽略 done，下一轮让 Orchestrator 先 check
        continue;
      }

      if (decision.type === "fail") {
        return finalize("failed", goal, summonTrail, store,
          checkConclusion ?? emptyCheck(0), startedAt, decision.reason);
      }
    }

    // 超过 maxRounds：标记失败
    return finalize("failed", goal, summonTrail, store,
      checkConclusion ?? emptyCheck(0), startedAt,
      `已达最大召唤轮次 ${config.maxRounds}`);
  } finally {
    store.dispose();
  }
}

// ═══ Orchestrator LLM 决策 ═══

async function decide(
  goal: string,
  store: ISignalStore,
  summonTrail: SummonStep[],
  checkRound: number,
  ctx: LoopContext,
): Promise<OrchestratorDecision> {
  const systemPrompt = buildOrchestratorSystemPrompt();
  const userPrompt = buildOrchestratorUserPrompt(goal, store.getActive(), summonTrail, checkRound);

  const session = await createWorkerSession({
    systemPrompt,
    cwd: ctx.cwd || process.cwd(),
    modelStr: ctx.orchestratorModel ?? pickAvailableModel(ctx),
    ctx,
    logicalIsolation: true, // Orchestrator LLM 也是 fresh 隔离
  });

  await session.prompt(userPrompt);
  const text = extractLastText(session.messages as any[]);
  return parseOrchestratorDecision(text);
}

// ═══ 召唤 worker（复用 leaf.execute 的角色能力，但写入 SignalStore）═══

async function summon(
  role: RoleName,
  task: string,
  goal: string,
  ctx: LoopContext,
  store: ISignalStore,
  tools?: string[],
): Promise<SummonStep> {
  const workerId = nextWorkerId(role);
  const startedAt = Date.now();

  // 用临时 SignalBus 桥接：leaf.execute 内部用 worker_sendSignal customTool
  // 写入 dteam.signalBus，我们把它的信号转发到 SignalStore。
  // Phase 1 简化：直接给 leaf 一个桥接 ctx，signalBus 桥接到 store。
  const signals: Signal[] = [];
  const bridgeBus = makeBridgeBus(store, signals, workerId);

  const leafCtx = {
    ...ctx,
    logicalIsolation: true, // 0.6.0 worker 不加载扩展，保持 fresh
    onWorkerSession: (session: any) => {
      // 0.6.0 双通道：session.subscribe 被动采集 worker turn_end，作为 progress 信号写 SignalStore
      attachSubscribeToStore(session, store, workerId);
    },
    // 0.6.0 Phase 3：Multi-Provider Routing — 该角色的主模型 + fallback
    model: undefined, // 让 pickAvailableModel 走 ctx.modelOverrides/fallbackModels 路径
    dteam: {
      signalBus: bridgeBus,
      runsStore: makeNoopRunsStore(),
      runId: store.getGoalId(),
      workerId,
      pendingSupplements: new Map<string, (value: string | null) => void>(),
      injectionQueue: new Map<string, string[]>(),
    },
  };

  // 0.6.0 Phase 3：Multi-Provider Routing — 解析该角色的主模型 + fallback
  const { modelStr: usedModel, model: resolvedModel } = resolveModelWithFallback(
    role, ctx.modelRegistry, ctx.model, ctx.modelOverrides, ctx.fallbackModels,
  );
  if (resolvedModel) leafCtx.model = resolvedModel;

  const result = await executeLeafSafe(role, task, leafCtx, goal, tools);

  return {
    id: `summon-${workerId}`,
    role,
    task,
    result,
    status: result === "(no output)" || result.startsWith("dteam:") ? "failed" : "done",
    signals,
    model: usedModel,
    ...(tools && tools.length > 0 ? { tools } : {}),
    startedAt,
    finishedAt: Date.now(),
  };
}

// ═══ 并发召唤（Phase 3 Adaptive Concurrency）═══

/**
 * 并发召唤 count 个同类 worker。受 AdaptiveConcurrency 调控：
 *  - 有槽则并行起 worker；无槽则串行等
 *  - worker 失败含 429 → concurrencyCtrl.recordRateLimit() 降并发
 */
async function summonParallel(
  role: RoleName,
  task: string,
  count: number,
  goal: string,
  ctx: LoopContext,
  store: ISignalStore,
  ctrl: AdaptiveConcurrency,
  tools?: string[],
): Promise<SummonStep[]> {
  const tasks: Promise<SummonStep>[] = [];
  for (let i = 0; i < count; i++) {
    // 等待并发槽（简化：自旋等待，单 goal 生命周期内）
    while (!ctrl.acquire()) {
      await new Promise(r => setTimeout(r, 50));
    }
    tasks.push(summon(role, `${task}（并发 #${i + 1}/${count}）`, goal, ctx, store, tools).then(step => {
      // 检查结果是否含 429（rate limit）
      const hit429 = step.result?.includes("429") || step.result?.toLowerCase().includes("rate limit");
      if (hit429) ctrl.recordRateLimit();
      ctrl.release(!hit429 && step.status === "done");
      return step;
    }));
  }
  return Promise.all(tasks);
}

// ═══ session.subscribe 双通道：被动采集 worker turn_end 作为 progress 信号 ═══

/**
 * 挂 session.subscribe：worker 每轮 turn_end 时，自动 emit 一个 progress 信号到 SignalStore。
 * 这样即使 worker 不主动调 worker_sendSignal，Orchestrator 也能感知 worker 进展。
 */
function attachSubscribeToStore(session: any, store: ISignalStore, workerId: string): void {
  if (typeof session.subscribe !== "function") return;
  try {
    session.subscribe((event: any) => {
      // turn_end：worker 完成一轮对话
      if (event?.type === "turn_end") {
        store.emit({
          id: `s-sub-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          type: "progress",
          workerId,
          runId: store.getGoalId(),
          timestamp: Date.now(),
          data: {
            action: "run",
            target: "(turn_end)",
            summary: `worker ${workerId} 完成一轮`,
          },
        });
      }
      // message_end + assistant：可抽取 found（可选，Phase 2 先只做 turn_end）
    });
  } catch {
    // subscribe 失败不阻塞 worker 执行
  }
}

/** 安全调用 leaf.execute，失败返回错误字符串（不让 loop 崩） */
async function executeLeafSafe(
  role: RoleName, task: string, ctx: any, goal: string, tools?: string[],
): Promise<string> {
  try {
    const { execute } = await import("./leaf.js");
    return await execute(role, task, ctx, goal, tools);
  } catch (e) {
    return `dteam: worker 执行失败 — ${(e as Error).message}`;
  }
}

// ═══ SignalBus → SignalStore 桥接 ═══

/**
 * leaf.execute 内部用 ISignalBus 接口（worker_sendSignal customTool）。
 * 这里造一个桥接 Bus：emit 时同时写 SignalStore 和本地 signals 数组。
 */
function makeBridgeBus(store: ISignalStore, signals: Signal[], workerId: string): any {
  return {
    emit(signal: Signal): Signal {
      // 补全 workerId（worker_sendSignal 可能没填）
      const full: Signal = { ...signal, workerId: signal.workerId || workerId };
      store.emit(full);
      signals.push(full);
      return full;
    },
    getHistory(wId?: string): Signal[] {
      if (wId) return signals.filter(s => s.workerId === wId);
      return [...signals];
    },
    getByRun(): Signal[] {
      return [...signals];
    },
    on(type: string, listener: (s: Signal) => void): () => void {
      return store.on(type as Signal["type"], listener);
    },
  };
}

/** Noop RunsStore：Phase 1 不用 RunsStore（轨迹自己记在 summonTrail） */
function makeNoopRunsStore(): any {
  return {
    createRun: () => "noop",
    addWorker: () => {},
    getWorker: () => null,
    getAllWorkers: () => [],
    appendSignal: () => {},
    finishWorker: () => {},
  };
}

// ═══ 收口 ═══

function finalize(
  status: "done" | "failed",
  goal: string,
  summonTrail: SummonStep[],
  store: ISignalStore,
  checkConclusion: CheckResult,
  startedAt: number,
  failReason?: string,
): DteamResult6 {
  const elapsedMs = Date.now() - startedAt;
  const signalSnapshot = store.getAll();
  const doneCount = summonTrail.filter(s => s.status === "done").length;

  const summary = status === "done"
    ? `目标达成（${doneCount}/${summonTrail.length} 次召唤，check 通过）`
    : failReason ?? `目标未达成（${doneCount}/${summonTrail.length} 次召唤）`;

  return {
    status,
    goal,
    summonTrail,
    signalSnapshot,
    checkConclusion,
    summary,
    elapsedMs,
    version: "0.6.0" as typeof LOOP_TYPES_VERSION,
  };
}

function emptyCheck(round: number): CheckResult {
  return { passed: false, output: "(未执行 check)", round };
}
