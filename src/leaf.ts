/**
 * dteam 0.7 fresh worker dispatch（历史同步入口；0.8 生产路径走 WorkerManager）。
 *
 * 每次创建逻辑隔离的进程内 AgentSession；同档模型链失败后自动尝试下一个同档候选，
 * 不再自动跨档到 T1（跨档升级由主代理决策，见 ADR 0012）。没有 Orchestrator Loop、
 * Signal Store 或五角色执行链。
 */

import { createWorkerSession } from "./session.js";
import { DTEAM_CONFIG } from "./config.js";
import { formatDuration } from "./duration.js";
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
  /** Pi 工具调用取消信号；取消后不继续同档 provider 回退。 */
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
 * 同档显式 provider fallback 逐个尝试；不再自动跨档到 T1——若该档所有候选失败，
 * 直接返回 failed，由调用方（主代理）决定下一步（见 ADR 0012）。请求档解析出的
 * tools（显式或默认）始终作为所有尝试的权限上限。
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

  const attemptTiers: Tier[] = [request.tier];
  // 同档候选自动回退；跨档升级只由主代理明确决定（ADR 0012），不在 dispatch 内跳 T1。
  const requestTools = getTierTools(request.tier, request.tools);
  let lastTier = request.tier;
  let lastThinking = getTierThinking(request.tier, request.thinking);
  let lastTools = requestTools;

  for (const tier of attemptTiers) {
    // 调用方 thinking 覆盖只作用于请求档；不再自动跨档回退（ADR 0012）。
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
  const timeoutMs = ctx.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs;
  const deadline = Date.now() + timeoutMs;
  let acquired = false;
  let succeeded = false;

  if (limiter) {
    await acquireSlot(limiter, ctx.signal, deadline, timeoutMs);
    acquired = true;
  }

  try {
    throwIfCanceled(ctx.signal);
    const session = await createSessionBeforeDeadline({
      tier,
      cwd: ctx.cwd || process.cwd(),
      modelStr,
      ctx,
      builtInTools: tools,
      thinkingLevel: thinking,
      logicalIsolation: true,
    }, deadline, timeoutMs, ctx.signal);
    throwIfCanceled(ctx.signal);
    const output = await promptWithToolLimit(
      session,
      task,
      Math.max(1, deadline - Date.now()),
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

async function createSessionBeforeDeadline(
  options: Parameters<typeof createWorkerSession>[0],
  deadline: number,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<any> {
  throwIfCanceled(signal);
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let cancelListener: (() => void) | undefined;
  const creation = createWorkerSession(options);

  return new Promise<any>((resolve, reject) => {
    const cleanup = () => {
      if (timer) clearTimeout(timer);
      if (signal && cancelListener) signal.removeEventListener("abort", cancelListener);
    };
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    timer = setTimeout(() => fail(timeoutError(timeoutMs)), Math.max(1, deadline - Date.now()));
    if (signal) {
      cancelListener = () => fail(new DispatchCanceledError());
      signal.addEventListener("abort", cancelListener, { once: true });
    }
    void creation.then(
      async (session) => {
        if (settled || signal?.aborted) {
          await abortWorker(session);
          return;
        }
        settled = true;
        cleanup();
        resolve(session);
      },
      (error) => fail(error instanceof Error ? error : new Error(String(error))),
    );
  });
}

async function promptWithToolLimit(
  session: any,
  task: string,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<string> {
  let toolCallCount = 0;
  let abortedByToolLimit = false;
  let toolLimitAbort: Promise<void> | undefined;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  let cancelListener: (() => void) | undefined;
  const unsubscribe = typeof session.subscribe === "function"
    ? session.subscribe((event: any) => {
        if (event?.type !== "tool_execution_end" || abortedByToolLimit) return;
        toolCallCount += 1;
        if (toolCallCount >= DTEAM_CONFIG.dispatch.maxToolRounds) {
          abortedByToolLimit = true;
          toolLimitAbort ??= abortWorker(session);
        }
      })
    : undefined;

  try {
    throwIfCanceled(signal);
    let timedOut = false;
    let timeoutFailure: Error | undefined;
    const timeoutResult = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        timedOut = true;
        timeoutFailure = timeoutError(timeoutMs);
        void abortWorker(session).then(() => reject(timeoutFailure));
      }, timeoutMs);
    });
    const races: Promise<unknown>[] = [session.prompt(task), timeoutResult];
    if (signal) {
      races.push(new Promise<never>((_resolve, reject) => {
        cancelListener = () => {
          void abortWorker(session).then(() => reject(new DispatchCanceledError()));
        };
        signal.addEventListener("abort", cancelListener, { once: true });
      }));
    }
    await Promise.race(races);
    if (timedOut) throw timeoutFailure ?? timeoutError(timeoutMs);
    if (abortedByToolLimit) {
      await toolLimitAbort;
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

async function acquireSlot(
  limiter: AdaptiveConcurrency,
  signal: AbortSignal | undefined,
  deadline: number,
  timeoutMs: number,
): Promise<void> {
  while (!limiter.acquire()) {
    throwIfCanceled(signal);
    const waitMs = deadline - Date.now();
    if (waitMs <= 0) throw timeoutError(timeoutMs);
    await new Promise<void>((resolve, reject) => {
      let onAbort: (() => void) | undefined;
      const timeout = setTimeout(() => {
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
        resolve();
      }, Math.min(10, waitMs));
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

function timeoutError(timeoutMs: number): Error {
  return new Error(`worker 执行超时（${formatDuration(timeoutMs)}）`);
}

function throwIfCanceled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new DispatchCanceledError();
}

async function abortWorker(session: any): Promise<void> {
  try {
    const aborted = session.abort?.();
    if (aborted && typeof aborted.then === "function") {
      await Promise.race([
        Promise.resolve(aborted).catch(() => {}),
        new Promise<void>((resolve) => setTimeout(resolve, DTEAM_CONFIG.dispatch.abortGraceMs)),
      ]);
    }
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
