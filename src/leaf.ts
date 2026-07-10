/**
 * dteam worker 执行器（leaf）
 *
 * 0.7 主路径：`dispatch(request, ctx)` 按 T1/T2/T3 创建一次 fresh worker。
 * `execute(role, …)` 仅为 0.6 Orchestrator Loop 过渡兼容，随旧 runtime 一起删除。
 *
 * 拆出去的子文件：
 *  - src/leaf/worker-id.ts : nextWorkerId
 *  - src/leaf/extract.ts   : extractFinalText
 *  - src/leaf/supplement.ts : waitForSupplement
 */

import { createWorkerSession, pickAvailableModel } from "./session.js";
import { DTEAM_CONFIG } from "./config.js";
import { AdaptiveConcurrency } from "./dispatch/concurrency.js";
import { isRateLimitError, tierModelCandidates } from "./dispatch/model-routing.js";
import { TIER_MODEL_ROUTES, getTierThinking, getTierTools } from "./session/tier-config.js";
import type { DteamContext } from "./types/context.js";
import type { DispatchAttempt, DispatchRequest, DispatchResult, Tier, TierModelRoutes } from "./types/dispatch.js";
import type { RoleName } from "./types/role.js";
import { nextWorkerId } from "./leaf/worker-id.js";
import { extractLastText } from "./leaf/extract.js";
import { waitForSupplement } from "./leaf/supplement.js";

/**
 * 用指定角色执行一个任务。
 * 支持信号自愈：叶子发 help → 等待根注入补充信息 → 继续执行。
 *
 * @param tools 可选：显式指定此 worker 的工具子集（0.4.1 已落地，方案 D）。
 *              undefined → 走 ROLE_DEFAULTS[role].tools（0.4.0 兼容行为）。
 *              设计：见 doc/40-版本实施方案/41-工具动态加载方案.md
 */
export async function execute(
  role: RoleName,
  task: string,
  ctx: LeafContext,
  goal: string,
  tools?: string[],
  extraCustomTools?: any[],
): Promise<string> {
  const dteam = ctx.dteam;
  const workerId = dteam?.currentStepId ?? nextWorkerId(role);
  const input = `[全局目标: ${goal}]\n\n${task}`;

  // 注册 worker 到 runs
  if (dteam) {
    dteam.runsStore.addWorker(dteam.runId, {
      id: workerId, role, task, input,
      signals: [], startedAt: Date.now(), status: "running",
    });
  }

  // 构建 worker 级 dteamContext（覆盖 workerId）
  const workerDteamCtx: DteamContext | undefined = dteam
    ? { signalBus: dteam.signalBus, runsStore: dteam.runsStore, runId: dteam.runId, workerId, pendingSupplements: dteam.pendingSupplements, injectionQueue: dteam.injectionQueue }
    : undefined;

  const session = await createWorkerSession({
    role,
    cwd: ctx.cwd || process.cwd(),
    modelStr: pickAvailableModel(ctx),
    ctx,
    dteamContext: workerDteamCtx,
    builtInTools: tools,
    customTools: extraCustomTools,
    logicalIsolation: ctx.logicalIsolation,
    onSession: ctx.onWorkerSession,
  });

  // maxToolRounds 防护：单次 prompt 内工具调用超限则 abort 中断 worker
  // 慢模型（或角色 prompt 不清晰）可能让 worker 陷入无限工具调用循环
  let toolCallCount = 0;
  let abortedByToolLimit = false;
  const unsubscribe = typeof session.subscribe === "function"
    ? session.subscribe((ev: any) => {
        if (ev?.type === "tool_execution_end") {
          toolCallCount += 1;
          if (toolCallCount >= DTEAM_CONFIG.leaf.maxToolRounds && !abortedByToolLimit) {
            abortedByToolLimit = true;
            session.abort()?.catch?.(() => {});
          }
        }
      })
    : null;

  let currentTask = input;
  let output = "(no output)";

  for (let round = 0; round < DTEAM_CONFIG.leaf.maxHelpRounds; round++) {
    const roundStart = Date.now();
    await session.prompt(currentTask);

    // 工具调用上限中断：不进入 help 自愈，直接跳出返回中断输出
    if (abortedByToolLimit) break;

    output = extractLastText(session.messages as any[]);

    if (!dteam) break;

    // 检查本轮新发的 help 信号 或 根转发的内容
    const helpSignals = dteam.signalBus.getHistory(workerId)
      .filter(s => s.type === "help" && s.timestamp >= roundStart);
    const injectionQueue = dteam.injectionQueue.get(workerId) ?? [];
    const hasInjection = injectionQueue.length > 0;

    if (helpSignals.length === 0 && !hasInjection) break;

    // 等待根注入补充信息（可能来自 help 自愈 或 root 转发）
    const supplement = await waitForSupplement(dteam, workerId, DTEAM_CONFIG.leaf.supplementTimeoutMs);
    if (!supplement) break;

    const source = hasInjection ? "根转发（来自其他叶子的发现/进度）" : "help 信号响应";
    currentTask = `## 补充信息（${source}）\n${supplement}\n\n请继续完成原任务。不要重复已完成的工作，直接从补充信息出发继续。`;
  }

  // 取最终输出（被中断时也取已有的 assistant 文本）
  output = extractLastText(session.messages as any[]);
  if (abortedByToolLimit) {
    output = `${output}\n\n[worker 因工具调用上限（${DTEAM_CONFIG.leaf.maxToolRounds} 次）被中断；可能未完成全部工作]`;
  }
  if (typeof unsubscribe === "function") {
    try { unsubscribe(); } catch {}
  }

  // 标记 worker 完成
  if (dteam) {
    dteam.runsStore.finishWorker(dteam.runId, workerId, output,
      output === "(no output)" ? "failed" : "done");
  }

  return output;
}

/**
 * 叶子执行器的最小 ctx 接口（修 L-1：去掉 ctx: any）。
 * 完整 PiExtensionContext 有更多字段，这里只声明 leaf 用到的。
 */
export interface LeafContext {
  cwd: string;
  dteam?: DteamContext;
  modelRegistry: any;
  model?: { provider: string; id: string };
  [k: string]: any; // 兼容其他字段（session 创建时透传）
}

/** 0.7 单次派发需要的最小上下文；不含 signal / run / task plan 状态。 */
export interface DispatchContext extends Omit<LeafContext, "dteam"> {
  tierModelRoutes?: TierModelRoutes;
  /** 单个 worker prompt 总超时；缺省使用 DTEAM_CONFIG.dispatch.workerTimeoutMs。 */
  timeoutMs?: number;
  /** 可选共享 limiter；主模型并发调用 dispatch 时由入口注入。 */
  concurrency?: AdaptiveConcurrency;
}

/**
 * 按 T1/T2/T3 执行一次 fresh worker 派发。
 *
 * 同档的显式 provider fallback 逐个尝试；请求 T1 以外的档位全部硬失败时，
 * 再用 T1 重做。调用方显式 tools 始终作为所有尝试的权限上限。
 */
export async function dispatch(request: DispatchRequest, ctx: DispatchContext): Promise<DispatchResult> {
  const startedAt = Date.now();
  const attempts: DispatchAttempt[] = [];

  if (!request.task.trim()) {
    return failedResult(request, request.tier, getTierThinking(request.tier, request.thinking), getTierTools(request.tier, request.tools), attempts, startedAt, "dteam_dispatch: task 不能为空");
  }

  const attemptTiers: Tier[] = request.tier === "T1" ? ["T1"] : [request.tier, "T1"];
  let lastTier = request.tier;
  let lastThinking = getTierThinking(request.tier, request.thinking);
  let lastTools = getTierTools(request.tier, request.tools);

  for (const tier of attemptTiers) {
    const thinking = getTierThinking(tier, request.thinking);
    const tools = getTierTools(tier, request.tools);
    lastTier = tier;
    lastThinking = thinking;
    lastTools = tools;

    const candidates = tierModelCandidates(tier, ctx.model, ctx.tierModelRoutes ?? TIER_MODEL_ROUTES);
    if (candidates.length === 0) {
      attempts.push({ tier, error: "没有可用的档位模型配置或 ctx.model" });
      continue;
    }

    for (const model of candidates) {
      try {
        const result = await runDispatchAttempt(tier, model, request.task, thinking, tools, ctx);
        return {
          status: "done",
          task: request.task,
          requestedTier: request.tier,
          tier,
          thinking,
          tools,
          result,
          model,
          fellBack: tier !== request.tier,
          attempts,
          elapsedMs: Date.now() - startedAt,
        };
      } catch (error) {
        attempts.push({ tier, model, error: errorMessage(error) });
      }
    }
  }

  return failedResult(
    request,
    lastTier,
    lastThinking,
    lastTools,
    attempts,
    startedAt,
    attempts.at(-1)?.error ?? "dteam_dispatch: 所有模型尝试均失败",
  );
}

async function runDispatchAttempt(
  tier: Tier,
  modelStr: string,
  task: string,
  thinking: DispatchResult["thinking"],
  tools: string[],
  ctx: DispatchContext,
): Promise<string> {
  const limiter = ctx.concurrency;
  let acquired = false;
  let succeeded = false;

  if (limiter) {
    while (!limiter.acquire()) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    acquired = true;
  }

  try {
    const session = await createWorkerSession({
      tier,
      cwd: ctx.cwd || process.cwd(),
      modelStr,
      ctx,
      builtInTools: tools,
      thinkingLevel: thinking,
      logicalIsolation: true,
    });
    const output = await promptWithToolLimit(
      session,
      task,
      ctx.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs,
    );
    succeeded = true;
    return output;
  } catch (error) {
    if (limiter && isRateLimitError(error)) limiter.recordRateLimit();
    throw error;
  } finally {
    if (acquired) limiter!.release(succeeded);
  }
}

async function promptWithToolLimit(session: any, task: string, timeoutMs: number): Promise<string> {
  let toolCallCount = 0;
  let abortedByToolLimit = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const unsubscribe = typeof session.subscribe === "function"
    ? session.subscribe((event: any) => {
        if (event?.type !== "tool_execution_end" || abortedByToolLimit) return;
        toolCallCount += 1;
        if (toolCallCount >= DTEAM_CONFIG.leaf.maxToolRounds) {
          abortedByToolLimit = true;
          abortWorker(session);
        }
      })
    : undefined;

  try {
    const timeoutError = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abortWorker(session);
        reject(new Error(`worker 执行超时（${timeoutMs}ms）`));
      }, timeoutMs);
    });
    await Promise.race([session.prompt(task), timeoutError]);
    if (abortedByToolLimit) {
      throw new Error(`worker 因工具调用上限（${DTEAM_CONFIG.leaf.maxToolRounds} 次）被中断`);
    }
    const output = extractLastText(session.messages as any[]);
    if (output === "(no output)") throw new Error("worker 未返回 assistant 文本");
    return output;
  } finally {
    if (timeout) clearTimeout(timeout);
    try { unsubscribe?.(); } catch { /* 释放监听失败不影响调用方 */ }
  }
}

function abortWorker(session: any): void {
  try {
    const aborted = session.abort?.();
    if (aborted && typeof aborted.catch === "function") void aborted.catch(() => {});
  } catch {
    // abort 失败不能阻止回退尝试
  }
}

function failedResult(
  request: DispatchRequest,
  tier: Tier,
  thinking: DispatchResult["thinking"],
  tools: string[],
  attempts: DispatchAttempt[],
  startedAt: number,
  error: string,
): DispatchResult {
  return {
    status: "failed",
    task: request.task,
    requestedTier: request.tier,
    tier,
    thinking,
    tools,
    result: "",
    fellBack: attempts.some((attempt) => attempt.tier !== request.tier),
    attempts,
    error,
    elapsedMs: Date.now() - startedAt,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
