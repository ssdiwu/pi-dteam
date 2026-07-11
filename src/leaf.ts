/**
 * dteam 0.7 fresh worker dispatch。
 *
 * 每次尝试创建逻辑隔离的进程内 AgentSession；同档模型链失败后，非 T1
 * 请求才回退 T1。没有 Orchestrator Loop、Signal Store 或五角色执行链。
 */

import { createWorkerSession } from "./session.js";
import { DTEAM_CONFIG } from "./config.js";
import { AdaptiveConcurrency } from "./dispatch/concurrency.js";
import { isRateLimitError, tierModelCandidates } from "./dispatch/model-routing.js";
import { TIER_MODEL_ROUTES, getTierThinking, getTierTools } from "./session/tier-config.js";
import type { DispatchAttempt, DispatchRequest, DispatchResult, Tier, TierModelRoutes } from "./types/dispatch.js";
import { extractLastText } from "./leaf/extract.js";

/** 0.7 单次派发需要的最小上下文；不含 signal / run / task plan 状态。 */
export interface DispatchContext {
  cwd?: string;
  modelRegistry: any;
  model?: { provider: string; id: string };
  tierModelRoutes?: TierModelRoutes;
  /** 单个 worker prompt 总超时；缺省使用 DTEAM_CONFIG.dispatch.workerTimeoutMs。 */
  timeoutMs?: number;
  /** Pi 工具调用取消信号；取消后不继续 provider/T1 回退。 */
  signal?: AbortSignal;
  /** 可选共享 limiter；主模型并发调用 dispatch 时由入口注入。 */
  concurrency?: AdaptiveConcurrency;
}

class DispatchCanceledError extends Error {
  constructor() {
    super("dteam_dispatch 已取消");
    this.name = "DispatchCanceledError";
  }
}

/**
 * 按 T1/T2/T3 执行一次 fresh worker 派发。
 *
 * 同档的显式 provider fallback 逐个尝试；请求 T1 以外的档位全部硬失败时，
 * 再用 T1 重做。请求档解析出的 tools（显式或默认）始终作为所有尝试的权限上限。
 */
export async function dispatch(request: DispatchRequest, ctx: DispatchContext): Promise<DispatchResult> {
  const startedAt = Date.now();
  const attempts: DispatchAttempt[] = [];

  if (!request.task.trim()) {
    return failedResult(request, request.tier, getTierThinking(request.tier, request.thinking), getTierTools(request.tier, request.tools), attempts, startedAt, "dteam_dispatch: task 不能为空");
  }
  if (ctx.signal?.aborted) {
    return failedResult(request, request.tier, getTierThinking(request.tier, request.thinking), getTierTools(request.tier, request.tools), attempts, startedAt, "dteam_dispatch 已取消");
  }

  const attemptTiers: Tier[] = request.tier === "T1" ? ["T1"] : [request.tier, "T1"];
  // 工具上限由请求档一次性解析；T3 默认只读不能因回退到 T1 而扩权。
  const requestTools = getTierTools(request.tier, request.tools);
  let lastTier = request.tier;
  let lastThinking = getTierThinking(request.tier, request.thinking);
  let lastTools = requestTools;

  for (const tier of attemptTiers) {
    // 调用方 thinking 覆盖只作用于请求档；T1 硬回退恢复 T1 的高思考默认。
    const thinking = getTierThinking(tier, tier === request.tier ? request.thinking : undefined);
    const tools = requestTools;
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
        if (error instanceof DispatchCanceledError) {
          return failedResult(request, tier, thinking, tools, attempts, startedAt, error.message);
        }
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
    await acquireSlot(limiter, ctx.signal);
    acquired = true;
  }

  try {
    throwIfCanceled(ctx.signal);
    const session = await createWorkerSession({
      tier,
      cwd: ctx.cwd || process.cwd(),
      modelStr,
      ctx,
      builtInTools: tools,
      thinkingLevel: thinking,
      logicalIsolation: true,
    });
    if (ctx.signal?.aborted) {
      abortWorker(session);
      throw new DispatchCanceledError();
    }
    const output = await promptWithToolLimit(
      session,
      task,
      ctx.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs,
      ctx.signal,
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

async function promptWithToolLimit(
  session: any,
  task: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  let toolCallCount = 0;
  let abortedByToolLimit = false;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelListener: (() => void) | undefined;
  const unsubscribe = typeof session.subscribe === "function"
    ? session.subscribe((event: any) => {
        if (event?.type !== "tool_execution_end" || abortedByToolLimit) return;
        toolCallCount += 1;
        if (toolCallCount >= DTEAM_CONFIG.dispatch.maxToolRounds) {
          abortedByToolLimit = true;
          abortWorker(session);
        }
      })
    : undefined;

  try {
    throwIfCanceled(signal);
    const timeoutError = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        abortWorker(session);
        reject(new Error(`worker 执行超时（${timeoutMs}ms）`));
      }, timeoutMs);
    });
    const races: Promise<unknown>[] = [session.prompt(task), timeoutError];
    if (signal) {
      races.push(new Promise<never>((_resolve, reject) => {
        cancelListener = () => {
          abortWorker(session);
          reject(new DispatchCanceledError());
        };
        signal.addEventListener("abort", cancelListener, { once: true });
      }));
    }
    await Promise.race(races);
    if (abortedByToolLimit) {
      throw new Error(`worker 因工具调用上限（${DTEAM_CONFIG.dispatch.maxToolRounds} 次）被中断`);
    }
    const output = extractLastText(session.messages as any[]);
    if (output === "(no output)") throw new Error("worker 未返回 assistant 文本");
    return output;
  } finally {
    if (timeout) clearTimeout(timeout);
    if (signal && cancelListener) signal.removeEventListener("abort", cancelListener);
    try { unsubscribe?.(); } catch { /* 释放监听失败不影响调用方 */ }
  }
}

async function acquireSlot(limiter: AdaptiveConcurrency, signal?: AbortSignal): Promise<void> {
  while (!limiter.acquire()) {
    throwIfCanceled(signal);
    await new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const timeout = setTimeout(() => {
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        resolve();
      }, 10);
      if (!signal) return;
      onAbort = () => {
        clearTimeout(timeout);
        signal.removeEventListener("abort", onAbort!);
        reject(new DispatchCanceledError());
      };
      signal.addEventListener("abort", onAbort, { once: true });
    });
  }
}

function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DispatchCanceledError();
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
