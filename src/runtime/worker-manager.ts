import { DTEAM_CONFIG } from "../config.js";
import { formatDuration } from "../duration.js";
import { AdaptiveConcurrency } from "../dispatch/concurrency.js";
import { isRateLimitError, tierModelCandidates } from "../dispatch/model-routing.js";
import { getTierPrompt, getTierTools, parseTierModelCandidate, tierModelRoutesFromEnv } from "../session/tier-config.js";
import { createWorkerSession } from "../session.js";
import { extractLastText } from "./extract.js";
import type { Tier, TierModelRoutes } from "../types/dispatch.js";
import { createToolPolicy, validateRequestedTools } from "./tool-policy.js";
import { RequestState } from "./request-state.js";
import { SignalLog } from "./signal-log.js";
import { makeSignalTool } from "./signal-tool.js";
import { makeReportTool, parseWorkerReport } from "./report-tool.js";
import { sanitizeSensitive, sanitizeUnknown, truncate } from "./sanitize.js";
import { appendUsageLedger } from "./usage-ledger.js";
import { MAX_WORKERS_PER_DISPATCH, REPORT_TOOL_NAME, SIGNAL_TOOL_NAME, type DispatchAccepted, type DteamWaitResult, type ParentEvent, type ParentResponse, type RecoveryAction, type TimeoutDiagnostic, type WaitRequest, type WorkerReport, type WorkerRequest, type WorkerSignal, type WorkerSnapshot } from "./types.js";

interface Waiter {
  workerIds: Set<string>;
  startedAt: number;
  timeoutMs: number;
  resolve: (result: DteamWaitResult) => void;
  timer: ReturnType<typeof setTimeout>;
}

type ParentEventDelivery = "follow_up" | "wait_only";

interface WriteInterruptedGuard {
  reason?: string;
  writeScope: string[];
}

interface RespondResult {
  workerId: string;
  requestId: string;
  state: string;
  writeInterrupted?: WriteInterruptedGuard;
}

interface RecoverResult {
  workerId: string;
  requestId: string;
  state: string;
  writeInterrupted?: WriteInterruptedGuard;
}

interface QueuedParentEvent {
  event: ParentEvent;
  delivery: ParentEventDelivery;
}

interface WorkerRecord extends WorkerSnapshot {
  controller: AbortController;
  session?: any;
  policy: ReturnType<typeof createToolPolicy>;
  attemptBudgetMs: number;
  totalBudgetMs: number;
  attemptConsumedMs: number;
  consumedMs: number;
  recoveryConsumedMs: number;
  timeoutRecoveryCount: number;
  recoverySummary?: string;
  lastRenderAt?: number;
  pendingRender?: boolean;
  renderTimer?: ReturnType<typeof setTimeout>;
  toolCallCount: number;
  toolCallBudget: number;
  toolBudgetExtensionCount: number;
  toolLimitReached: boolean;
  rejectToolLimit?: (error: Error) => void;
  activeCandidateId?: string;
  report?: WorkerReport;
  handoff?: WorkerRequest["handoff"];
  writeScope?: string[];
  writeInterrupted?: boolean;
}

export interface WorkerManagerOptions {
  cwd: string;
  modelRegistry: any;
  model?: { provider: string; id: string };
  parentActiveTools: string[];
  getParentActiveTools?: () => string[];
  tierModelRoutes?: TierModelRoutes;
  concurrency: AdaptiveConcurrency;
  timeoutMs?: number;
  /** 测试或受控调用可覆盖当前 worker 的初始累计预算；生产默认使用 workerTimeoutMs。 */
  totalBudgetMs?: number;
  usageLedger?: { agentDir: string; parentSessionId: string };
  onParentEvent?: (event: ParentEvent) => void;
  /** 有未消费 parent event 时通知宿主；宿主应在主代理 idle/settled 后 flush。 */
  onParentEventAvailable?: () => void;
  onChange?: () => void;
}

/** 当前 Pi 会话唯一的 worker 生命周期所有者；不理解依赖，也不保存 batch。 */
export class WorkerManager {
  readonly signalLog = new SignalLog();
  readonly requestState = new RequestState();
  private readonly records = new Map<string, WorkerRecord>();
  private readonly options: WorkerManagerOptions;
  private pendingParentEvents: QueuedParentEvent[] = [];
  private parentEventTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly waiters = new Set<Waiter>();
  private closed = false;
  private compactionResyncPending = false;

  constructor(options: WorkerManagerOptions) { this.options = options; }

  dispatch(requests: WorkerRequest[]): DispatchAccepted[] {
    if (this.closed) throw new Error("dteam: session runtime 已关闭");
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > MAX_WORKERS_PER_DISPATCH) throw new Error("dteam: workers 数量必须是 1–32");
    const accepted: DispatchAccepted[] = [];
    const parentActiveTools = this.options.getParentActiveTools?.() ?? this.options.parentActiveTools;
    const prepared = requests.map((request) => {
      this.validateRequest(request);
      const normalizedRequest = request.handoff ? { ...request, handoff: this.sanitizeHandoff(request.handoff) } : request;
      const baseTools = getTierTools(normalizedRequest.tier);
      const policy = createToolPolicy({ baseTools, addTools: normalizedRequest.addTools, parentActiveTools, signalToolName: SIGNAL_TOOL_NAME });
      policy.initialActiveTools = [...new Set([...policy.initialActiveTools, REPORT_TOOL_NAME])];
      return { request: normalizedRequest, policy };
    });
    for (const { request, policy } of prepared) {
      const id = crypto.randomUUID();
      const record: WorkerRecord = {
        id, title: request.title.trim(), task: request.task.trim(), requestedTier: request.tier, activeTier: request.tier,
        fallbackTrail: [], state: "queued", activeTools: policy.initialActiveTools, controller: new AbortController(), policy,
        handoff: request.handoff, writeScope: request.writeScope,
        attemptBudgetMs: Math.min(this.options.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs, this.options.totalBudgetMs ?? this.options.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs),
        totalBudgetMs: this.options.totalBudgetMs ?? this.options.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs,
        attemptConsumedMs: 0,
        consumedMs: 0,
        recoveryConsumedMs: 0,
        timeoutRecoveryCount: 0,
        toolCallCount: 0,
        toolCallBudget: toolCallBudgetForTier(request.tier),
        toolBudgetExtensionCount: 0,
        toolLimitReached: false,
      };
      this.records.set(id, record);
      this.signal(record, "worker_queued", {});
      accepted.push({ workerId: id, title: record.title, tier: record.requestedTier, state: "queued" });
      void this.run(record);
    }
    return accepted;
  }

  respond(workerId: string, requestId: string, response: ParentResponse): RespondResult {
    const record = this.records.get(workerId);
    if (!record || isTerminal(record.state)) throw new Error("dteam: worker 已结束或不存在");
    const pending = this.requestState.get(workerId, requestId);
    if (!pending || pending.workerId !== workerId) throw new Error("dteam: request 不存在或不属于该 worker");
    if (!responseAllowed(pending.kind, response.type)) throw new Error(`dteam: ${response.type} 不能回应 ${pending.kind}`);
    if (response.type === "grant_tools") {
      const tools = validateRequestedTools(response.tools, record.policy);
      try {
        if (!record.session?.setActiveToolsByName) throw new Error("worker session 不支持工具切换");
        record.session.setActiveToolsByName([...record.activeTools, ...tools]);
        record.activeTools = [...new Set([...record.activeTools, ...tools])];
        this.signal(record, "grant_tools", { tools });
      } catch (error) {
        const denial: ParentResponse = { type: "deny", reason: `工具授权失败：${errorMessage(error)}` };
        this.signal(record, "deny", denial);
        this.requestState.respond(workerId, requestId, denial);
        if (!this.requestState.list().some((request) => request.workerId === workerId)) record.state = "running";
        this.signal(record, "worker_resumed", { requestId, remainingRequests: this.requestState.list().filter((request) => request.workerId === workerId).length });
        return { workerId, requestId, state: record.state };
      }
    } else if (response.type === "grant_tool_budget") {
      this.grantToolBudget(record, response.additionalCalls);
      this.signal(record, "grant_tool_budget", { additionalCalls: response.additionalCalls, toolCallBudget: record.toolCallBudget });
    } else if (response.type === "cancel") {
      this.signal(record, "cancel", response);
      this.requestState.respond(workerId, requestId, response);
      const writeInterrupted = this.cancel(workerId, response.reason, false);
      return { workerId, requestId, state: record.state, ...(writeInterrupted ? { writeInterrupted } : {}) };
    } else {
      this.signal(record, response.type, response);
    }
    this.requestState.respond(workerId, requestId, response);
    if (pending.kind === "timeout_recovery") return { workerId, requestId, state: record.state };
    if (!this.requestState.list().some((request) => request.workerId === workerId)) record.state = "running";
    this.signal(record, "worker_resumed", { requestId, remainingRequests: this.requestState.list().filter((request) => request.workerId === workerId).length });
    return { workerId, requestId, state: record.state };
  }

  recover(workerId: string, requestId: string, action: RecoveryAction): RecoverResult {
    const record = this.records.get(workerId);
    if (!record || isTerminal(record.state)) throw new Error("dteam: worker 已结束或不存在");
    const pending = this.requestState.get(workerId, requestId);
    if (!pending || pending.kind !== "timeout_recovery") throw new Error("dteam: timeout recovery request 不存在或不属于该 worker");
    this.signal(record, "timeout_recovery_action", action);
    this.requestState.respond(workerId, requestId, action);
    const writeInterrupted = action.action === "stop" ? this.stopTimedOut(record, action.reason, false) : undefined;
    return { workerId, requestId, state: record.state, ...(writeInterrupted ? { writeInterrupted } : {}) };
  }

  receiveReport(workerId: string, report: unknown, candidateId?: string): { ok: true } {
    const record = this.records.get(workerId);
    if (!record || isTerminal(record.state)) throw new Error("dteam_report: worker 已结束或不存在");
    if (candidateId !== undefined && candidateId !== record.activeCandidateId) throw new Error("dteam_report: worker 候选已失效");
    if (record.report) throw new Error("dteam_report: 每个 worker 只能提交一次最终报告");
    record.report = this.sanitizeReport(parseWorkerReport(report));
    record.latestFinding = record.report.summary;
    this.signal(record, "worker_reported", {
      outcome: record.report.outcome,
      summary: record.report.summary,
      activities: record.report.activities,
      verification: {
        depth: record.report.verification.depth,
        status: record.report.verification.status,
        remaining: record.report.verification.remaining?.length ?? 0,
      },
      facts: record.report.facts.length,
      uncertainties: record.report.uncertainties?.length ?? 0,
    });
    return { ok: true };
  }

  private grantToolBudget(record: WorkerRecord, additionalCalls: number): void {
    const { min, max, step, maxPerWorker } = DTEAM_CONFIG.dispatch.toolCallBudgetExtension;
    if (!Number.isInteger(additionalCalls) || additionalCalls < min || additionalCalls > max || additionalCalls % step !== 0) {
      throw new Error(`dteam: additionalCalls 必须是 ${min}–${max} 的 ${step} 的倍数`);
    }
    if (record.toolBudgetExtensionCount >= maxPerWorker) {
      throw new Error("dteam: worker 工具调用额度只能追加一次；请重新 dispatch fresh worker");
    }
    record.toolCallBudget += additionalCalls;
    record.toolBudgetExtensionCount += 1;
  }

  async steer(workerId: string, instruction: string): Promise<void> {
    const record = this.records.get(workerId);
    if (!record || isTerminal(record.state)) throw new Error("dteam: worker 已结束或不存在");
    if (!instruction.trim()) throw new Error("dteam: steering 指令不能为空");
    if (!record.session?.steer) throw new Error("dteam: worker session 尚未可接管");
    await record.session.steer(instruction);
    this.signal(record, "steer", { instruction });
  }

  cancel(workerId: string, reason = "user_cancelled", notifyParent = true): WriteInterruptedGuard | undefined {
    const record = this.records.get(workerId);
    if (!record || isTerminal(record.state)) throw new Error("dteam: worker 已结束或不存在");
    record.cancelReason = reason;
    record.terminalReason = "user_cancelled";
    record.state = "cancelled";
    record.endedAt ??= Date.now();
    this.requestState.cancelWorker(workerId, reason);
    record.controller.abort();
    this.clearRenderTimer(record);
    void closeSession(record.session);
    this.signal(record, "worker_cancelled", { reason });
    const delivery: ParentEventDelivery = notifyParent ? "follow_up" : "wait_only";
    this.emit({ type: "cancelled", workerId, title: record.title, payload: { reason, state: record.state } }, delivery);
    const writeInterrupted = this.emitWriteInterrupted(record, reason, false, delivery);
    if (!notifyParent) this.discardPendingEventsFor(workerId);
    return writeInterrupted;
  }

  private shutdownWorker(record: WorkerRecord): void {
    if (isTerminal(record.state)) return;
    record.cancelReason = "session_shutdown";
    record.terminalReason = "session_shutdown";
    record.state = "shutdown";
    record.endedAt ??= Date.now();
    this.requestState.cancelWorker(record.id, "session_shutdown");
    record.controller.abort();
    this.clearRenderTimer(record);
    void closeSession(record.session);
    this.signal(record, "worker_shutdown", { reason: "session_shutdown" });
    this.emit({ type: "cancelled", workerId: record.id, title: record.title, payload: { reason: "session_shutdown", state: record.state } });
    this.emitWriteInterrupted(record, "session_shutdown");
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const record of this.records.values()) {
      if (!isTerminal(record.state)) this.shutdownWorker(record);
    }
    this.flushParentEvents();
    this.requestState.clear();
    for (const waiter of [...this.waiters]) this.settleWaiter(waiter, "worker_event", []);
    if (this.parentEventTimer) clearTimeout(this.parentEventTimer);
    this.parentEventTimer = undefined;
    this.pendingParentEvents = [];
  }

  get(workerId: string): WorkerSnapshot | undefined { return this.snapshot(this.records.get(workerId)); }
  list(): WorkerSnapshot[] { return [...this.records.values()].map((record) => this.snapshot(record)!); }
  active(): WorkerSnapshot[] { return this.list().filter((record) => ["queued", "running", "waiting"].includes(record.state)); }

  /** 标记下一次主模型 context 注入当前会话内未收口 worker 的有界摘要。 */
  markCompactionResync(): void {
    if (!this.closed) this.compactionResyncPending = true;
  }

  /** 一次性消费压缩后的重同步摘要；只读 Manager 内存，不写入 session。 */
  consumeCompactionResync(): string | undefined {
    if (!this.compactionResyncPending) return undefined;
    this.compactionResyncPending = false;
    const records = [...this.records.values()].filter(needsCompactionResync);
    if (!records.length) return undefined;
    const lines = [
      "<dteam_resync>",
      "以下 worker 仍需主代理裁决。writeScope 和 task 限制只约束对应 worker，不代表父任务完成。请根据局部范围、验证、remaining 与 uncertainties 决定后续动作。",
      ...records.flatMap(formatCompactionResyncRecord),
      "</dteam_resync>",
    ];
    return truncate(lines.join("\n"), DTEAM_CONFIG.dispatch.maxHandoffChars);
  }

  wait(workerIds: string[], timeoutMs: number): Promise<DteamWaitResult> {
    if (!Array.isArray(workerIds) || workerIds.length < 1 || workerIds.length > MAX_WORKERS_PER_DISPATCH || workerIds.some((id) => typeof id !== "string" || !id)) throw new Error("dteam: workerIds 必须是 1–32 个非空字符串");
    if (new Set(workerIds).size !== workerIds.length) throw new Error("dteam: workerIds 不可重复");
    if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > DTEAM_CONFIG.dispatch.maxWaitMs) throw new Error(`dteam: timeoutMs 必须是 1–${DTEAM_CONFIG.dispatch.maxWaitMs} 的整数`);
    for (const workerId of workerIds) if (!this.records.has(workerId)) throw new Error(`dteam: worker 不存在 ${workerId}`);
    const ids = new Set(workerIds);
    const startedAt = Date.now();
    const events = this.consumePendingEventsFor(ids);
    if (events.length > 0) return Promise.resolve(this.waitResult(ids, "worker_event", startedAt, timeoutMs, events));
    return new Promise<DteamWaitResult>((resolve) => {
      const waiter: Waiter = {
        workerIds: ids,
        startedAt,
        timeoutMs,
        resolve,
        timer: setTimeout(() => this.settleWaiter(waiter, "timeout", []), timeoutMs),
      };
      this.waiters.add(waiter);
    });
  }

  async receiveSignal(workerId: string, signal: WorkerSignal): Promise<unknown> {
    const record = this.records.get(workerId);
    if (!record || isTerminal(record.state)) throw new Error("dteam_signal: worker 已结束或不存在");
    this.signal(record, signal.kind, signal);
    if (signal.kind === "request_tools") {
      try {
        validateRequestedTools(signal.tools, record.policy);
      } catch (error) {
        const reason = errorMessage(error);
        this.signal(record, "deny", { reason });
        return { type: "deny", reason };
      }
    }
    if (signal.kind === "request_tool_budget" && record.toolBudgetExtensionCount >= DTEAM_CONFIG.dispatch.toolCallBudgetExtension.maxPerWorker) {
      const reason = "worker 工具调用额度已追加一次仍不足；主代理应重新 dispatch fresh worker";
      this.failForToolBudget(record, reason);
      return { type: "deny", reason };
    }
    if (signal.kind === "progress") return { ok: true };
    if (signal.kind === "finding") {
      record.latestFinding = truncate(sanitizeSensitive(signal.summary), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
      this.signalLog.setSnapshot(this.snapshot(record)!);
      return { ok: true };
    }
    if (this.requestState.get(workerId, signal.requestId)) {
      const reason = `dteam_signal: requestId 已存在 ${signal.requestId}`;
      this.signal(record, "deny", { requestId: signal.requestId, reason });
      return { type: "deny", reason };
    }
    record.state = "waiting";
    this.signal(record, "worker_waiting", { requestId: signal.requestId, kind: signal.kind });
    const waiting = this.requestState.wait({ workerId, requestId: signal.requestId, kind: signal.kind, payload: signal });
    const payload = signal.kind === "request_tool_budget"
      ? { ...signal, toolCallCount: record.toolCallCount, toolCallBudget: record.toolCallBudget, toolBudgetExtensionCount: record.toolBudgetExtensionCount }
      : signal;
    this.emit({ type: "request", workerId, title: record.title, payload });
    return waiting;
  }

  private async run(record: WorkerRecord): Promise<void> {
    let acquired = false;
    try {
      while (!this.options.concurrency.acquire()) {
        if (record.controller.signal.aborted) throw new Error("dteam: worker 已取消");
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      acquired = true;
      if (record.controller.signal.aborted || isTerminal(record.state)) return;
      this.beginAttempt(record);
      const result = await this.runTierCandidates(record);
      if (isTerminal(record.state)) return;
      if (!record.report) throw new Error("worker 未提交必需的 dteam_report");
      record.state = "completed"; record.result = result; record.endedAt = Date.now();
      await this.releaseSession(record);
      this.signal(record, "worker_completed", { result });
      this.emit({ type: "completed", workerId: record.id, title: record.title, payload: { result, report: this.reportWithProvenance(record), tier: record.activeTier, fallbackTrail: record.fallbackTrail, workerBoundary: { writeScope: [...(record.writeScope ?? [])], localOnly: true } } });
    } catch (error) {
      if (isTerminal(record.state) || record.controller.signal.aborted) return;
      if (error instanceof WorkerTimeoutError) {
        this.requestTimeoutRecovery(record, error);
        return;
      }
      record.state = "failed";
      record.terminalReason = errorMessage(error).includes("dteam_report") ? "missing_report" : "error";
      record.error = truncate(sanitizeSensitive(errorMessage(error)), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars); record.endedAt = Date.now();
      await this.releaseSession(record);
      this.signal(record, "worker_failed", { error: record.error });
      const delivery: ParentEventDelivery = error instanceof WorkerNoOutputError && !record.report && !record.writeScope?.length ? "wait_only" : "follow_up";
      this.emit({ type: "failed", workerId: record.id, title: record.title, payload: { error: record.error, state: record.state } }, delivery);
      this.emitWriteInterrupted(record, record.error);
    } finally {
      if (acquired) this.options.concurrency.release(record.state === "completed");
    }
  }
  private beginAttempt(record: WorkerRecord): void {
    record.state = "running";
    record.startedAt ??= Date.now();
    if (record.fallbackTrail.at(-1) !== record.activeTier) record.fallbackTrail.push(record.activeTier);
    record.lastActivity = "开始执行";
    record.attemptConsumedMs = 0;
    this.signal(record, "attempt_started", { tier: record.activeTier, budgetMs: record.attemptBudgetMs });
  }

  private async releaseSession(record: WorkerRecord): Promise<void> {
    const session = record.session;
    record.session = undefined;
    await closeSession(session);
  }

  private async runTierCandidates(record: WorkerRecord): Promise<string> {
    const tier = record.activeTier;
    let lastError: unknown;
    for (const candidate of tierModelCandidates(tier, this.options.model, this.options.tierModelRoutes ?? tierModelRoutesFromEnv())) {
      const { modelStr, thinkingLevel } = parseTierModelCandidate(candidate, tier);
      const remainingBudget = record.attemptBudgetMs - record.attemptConsumedMs;
      if (remainingBudget <= 0) throw new WorkerTimeoutError(`worker 累计预算已用尽（${formatDuration(record.totalBudgetMs)}）`);
      const attemptBudgetMs = Math.min(record.attemptBudgetMs, remainingBudget);
      const candidateId = crypto.randomUUID();
      record.activeCandidateId = candidateId;
      const creationStartedAt = Date.now();
      let creationAccounted = false;
      try {
        const session = await createSessionWithTimeout({
          tier, cwd: this.options.cwd, modelStr, ctx: { modelRegistry: this.options.modelRegistry },
          systemPrompt: workerSystemPrompt(tier, record.toolCallBudget),
          builtInTools: getTierTools(tier),
          registeredTools: [...new Set([...getTierTools(tier), ...record.policy.addTools, SIGNAL_TOOL_NAME, REPORT_TOOL_NAME])],
          initialActiveTools: record.activeTools,
          customTools: [makeSignalTool(record.id, this), makeReportTool(record.id, candidateId, this)],
          thinkingLevel,
          logicalIsolation: true,
        }, attemptBudgetMs, record.controller.signal);
        this.chargeAttemptTime(record, creationStartedAt);
        creationAccounted = true;
        if (record.attemptConsumedMs >= record.attemptBudgetMs) throw new WorkerTimeoutError(`worker attempt 预算已用尽（${formatDuration(record.attemptBudgetMs)}）`);
        record.session = session;
        record.liveText = undefined;
        record.liveThinking = undefined;
        record.liveTool = undefined;
        const unsubscribe = this.subscribeSession(record, session, candidateId, modelStr);
        try {
          if (record.controller.signal.aborted || isTerminal(record.state)) {
            await closeSession(session);
            throw new Error("dteam: worker 已取消");
          }
          const remainingAttemptBudget = record.attemptBudgetMs - record.attemptConsumedMs;
          if (remainingAttemptBudget <= 0) throw new WorkerTimeoutError(`worker 累计预算已用尽（${formatDuration(record.totalBudgetMs)}）`);
          return await this.promptWithTimeout(record, session, remainingAttemptBudget, candidateId);
        } finally {
          unsubscribe();
        }
      } catch (error) {
        if (record.activeCandidateId === candidateId) record.activeCandidateId = undefined;
        if (!creationAccounted) this.chargeAttemptTime(record, creationStartedAt);
        lastError = error;
        if (record.toolLimitReached) throw new WorkerToolLimitError(toolBudgetExhaustedMessage(record));
        if (record.controller.signal.aborted || error instanceof WorkerTimeoutError) throw error;
        await this.releaseSession(record);
        // Reports are candidate-attempt scoped; the next same-tier candidate must submit its own.
        record.report = undefined;
        this.requestState.cancelWorker(record.id, "worker_attempt_failed");
        if (!isTerminal(record.state)) record.state = "running";
        if (isRateLimitError(error)) this.options.concurrency.recordRateLimit();
      }
    }
    throw lastError instanceof Error ? lastError : new Error("dteam: 所有模型候选均失败");
  }

  private async promptWithTimeout(record: WorkerRecord, session: any, timeoutMs: number, candidateId: string): Promise<string> {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let timedOut = false;
    let timeoutError: WorkerTimeoutError | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        timeoutError = new WorkerTimeoutError(`worker 执行超时（${formatDuration(timeoutMs)}）`);
        void closeSession(session).then(() => reject(timeoutError));
      }, timeoutMs);
    });
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("dteam: worker 已取消"));
      if (record.controller.signal.aborted) onAbort();
      else record.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    let rejectToolLimit!: (error: Error) => void;
    const toolLimit = new Promise<never>((_, reject) => { rejectToolLimit = reject; });
    record.rejectToolLimit = rejectToolLimit;
    try {
      await Promise.race([session.prompt(this.promptTask(record)), timeout, cancelled, toolLimit]);
      if (timedOut) throw timeoutError ?? new WorkerTimeoutError(`worker 执行超时（${formatDuration(timeoutMs)}）`);
      if (!record.report) {
        const report = reportFromMessages(session.messages as any[]);
        if (report) this.receiveReport(record.id, report, candidateId);
      }
      const result = extractLastText(session.messages as any[]);
      if (result === "(no output)") throw new WorkerNoOutputError("worker 未返回 assistant 文本");
      return truncate(sanitizeSensitive(result), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    } finally {
      this.chargeAttemptTime(record, startedAt);
      if (timer) clearTimeout(timer);
      if (onAbort) record.controller.signal.removeEventListener("abort", onAbort);
      if (record.rejectToolLimit === rejectToolLimit) record.rejectToolLimit = undefined;
    }
  }

  private chargeAttemptTime(record: WorkerRecord, startedAt: number): void {
    const elapsedMs = Math.max(0, Date.now() - startedAt);
    record.attemptConsumedMs += elapsedMs;
    record.consumedMs += elapsedMs;
    if (record.timeoutRecoveryCount > 0) record.recoveryConsumedMs += elapsedMs;
  }

  private requestTimeoutRecovery(record: WorkerRecord, error: WorkerTimeoutError): void {
    this.requestState.cancelWorker(record.id, "worker_timeout_recovery");
    const requestId = crypto.randomUUID();
    const outputSummary = this.outputSummary(record) ?? "暂无输出";
    const diagnostic: TimeoutDiagnostic = {
      requestId,
      totalBudgetMs: record.attemptBudgetMs,
      attemptBudgetMs: record.attemptBudgetMs,
      maxRecoveryBudgetMs: DTEAM_CONFIG.dispatch.maxRecoveryBudgetMs,
      elapsedMs: record.consumedMs,
      lastActivity: record.lastActivity ?? "等待模型响应",
      currentTool: record.liveTool ?? "无",
      outputSummary,
    };
    record.session = undefined;
    record.timeoutDiagnostic = diagnostic;
    record.liveTool = undefined;
    record.state = "waiting";
    this.signal(record, "worker_timeout_requested", { error: error.message, ...diagnostic, tier: record.activeTier });
    const waiting = this.requestState.wait({ workerId: record.id, requestId, kind: "timeout_recovery", payload: diagnostic });
    this.emit({ type: "request", workerId: record.id, title: record.title, payload: { kind: "timeout_recovery", tier: record.activeTier, ...diagnostic } });
    this.emitWriteInterrupted(record, error.message);
    void waiting.then(
      (response) => this.applyTimeoutRecovery(record, response as RecoveryAction),
      (recoveryError) => this.stopTimedOut(record, errorMessage(recoveryError)),
    );
  }

  private applyTimeoutRecovery(record: WorkerRecord, response: RecoveryAction): void {
    if (isTerminal(record.state) || record.controller.signal.aborted) return;
    if (response.action === "stop") {
      this.stopTimedOut(record, response.reason);
      return;
    }
    if (record.recoveryConsumedMs >= DTEAM_CONFIG.dispatch.maxRecoveryBudgetMs) {
      this.stopTimedOut(record, "timeout recovery 累计预算已达上限");
      return;
    }
    if (record.timeoutRecoveryCount >= DTEAM_CONFIG.dispatch.maxTimeoutRecoveries) {
      this.stopTimedOut(record, "timeout recovery 次数已达上限");
      return;
    }
    const defaultAttemptBudget = this.options.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs;
    const remainingBudget = DTEAM_CONFIG.dispatch.maxRecoveryBudgetMs - record.recoveryConsumedMs;
    let tier = record.activeTier;
    let budgetMs = Math.min(defaultAttemptBudget, remainingBudget);
    if (response.action === "escalate") {
      if (!isNextTier(tier, response.tier)) {
        this.stopTimedOut(record, `不允许从 ${tier} 升级到 ${response.tier}`);
        return;
      }
      tier = response.tier;
      record.activeTools = [...new Set([...getTierTools(tier), SIGNAL_TOOL_NAME, REPORT_TOOL_NAME])];
    }
    if (response.action === "extend") {
      if (!Number.isFinite(response.additionalMs) || response.additionalMs <= 0) {
        this.stopTimedOut(record, "timeout recovery 延长预算无效");
        return;
      }
      if (record.recoveryConsumedMs + response.additionalMs > DTEAM_CONFIG.dispatch.maxRecoveryBudgetMs) {
        this.stopTimedOut(record, "timeout recovery 延长预算超过总上限");
        return;
      }
      const remainingAttemptBudget = Math.max(0, record.totalBudgetMs - record.attemptConsumedMs);
      budgetMs = Math.min(defaultAttemptBudget, remainingAttemptBudget + response.additionalMs);
    }
    this.queueRecoveryAttempt(record, tier, budgetMs);
    this.signal(record, "worker_recovery_started", { action: response.action, tier, budgetMs, recoveryCount: record.timeoutRecoveryCount });
    void this.run(record);
  }

  private queueRecoveryAttempt(record: WorkerRecord, tier: Tier, budgetMs: number): void {
    record.timeoutRecoveryCount += 1;
    record.writeInterrupted = false;
    record.report = undefined;
    record.activeTier = tier;
    record.totalBudgetMs = budgetMs;
    record.attemptBudgetMs = budgetMs;
    record.attemptConsumedMs = 0;
    record.recoverySummary = this.buildRecoverySummary(record);
    record.timeoutDiagnostic = undefined;
    record.error = undefined;
    record.endedAt = undefined;
    record.state = "queued";
  }

  private failForToolBudget(record: WorkerRecord, reason: string): void {
    if (isTerminal(record.state)) return;
    record.toolLimitReached = true;
    record.state = "failed";
    record.terminalReason = "error";
    record.error = reason;
    record.endedAt = Date.now();
    this.requestState.cancelWorker(record.id, reason);
    record.controller.abort();
    void closeSession(record.session);
    this.signal(record, "worker_tool_budget_exhausted", { reason, toolCallCount: record.toolCallCount, toolCallBudget: record.toolCallBudget });
    this.emit({ type: "failed", workerId: record.id, title: record.title, payload: { error: reason, state: record.state, toolCallCount: record.toolCallCount, toolCallBudget: record.toolCallBudget } });
    this.emitWriteInterrupted(record, reason);
  }

  private stopTimedOut(record: WorkerRecord, reason?: string, notifyParent = true): WriteInterruptedGuard | undefined {
    if (isTerminal(record.state)) return undefined;
    record.state = "timed_out";
    record.terminalReason = "timeout";
    record.error = reason ?? `worker 执行超时（${formatDuration(record.attemptBudgetMs)}）`;
    record.endedAt = Date.now();
    this.signal(record, "worker_timed_out", { error: record.error, diagnostic: record.timeoutDiagnostic });
    if (notifyParent) this.emit({ type: "failed", workerId: record.id, title: record.title, payload: { error: record.error, state: record.state, diagnostic: record.timeoutDiagnostic } });
    const writeInterrupted = this.emitWriteInterrupted(record, record.error);
    if (!notifyParent) this.discardPendingEventsFor(record.id);
    return writeInterrupted;
  }

  private outputSummary(record: WorkerRecord): string | undefined {
    const text = sanitizeSensitive(record.liveText || extractLastText(record.session?.messages as any[] ?? []));
    return text && text !== "(no output)" ? truncate(text, DTEAM_CONFIG.dispatch.maxRecoverySummaryChars) : undefined;
  }

  private buildRecoverySummary(record: WorkerRecord): string {
    const diagnostic = record.timeoutDiagnostic;
    const parts = [
      "这是上一次 fresh worker attempt 的裁剪恢复摘要；请验证后继续，不要把它当作最终结论。",
      `档位：${record.activeTier}；恢复次数：${record.timeoutRecoveryCount}。`,
      diagnostic ? `超时：预算 ${formatDuration(diagnostic.totalBudgetMs)}，已运行 ${formatDuration(diagnostic.elapsedMs)}；最后活动：${sanitizeSensitive(diagnostic.lastActivity)}。` : "",
      diagnostic?.currentTool ? `当前工具：${sanitizeSensitive(diagnostic.currentTool)}。` : "",
      diagnostic?.outputSummary ? `已有输出：${sanitizeSensitive(diagnostic.outputSummary)}` : "",
    ].filter(Boolean).join("\n");
    return truncate(sanitizeSensitive(parts), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
  }

  private promptTask(record: WorkerRecord): string {
    const task = sanitizeSensitive(record.task);
    const scope = record.writeScope?.length
      ? `\n\n--- worker write scope ---\n本 worker 的预期写入范围：${record.writeScope.join(", ")}。该范围只约束当前 worker，不定义父任务交付范围或完成条件。若已知某项检查因当前范围、工具或任务限制未覆盖，写入 verification.remaining；若仍可能影响结论但尚未查明，写入 uncertainties。`
      : "";
    const handoff = record.handoff ? `\n\n--- bounded handoff ---\n${JSON.stringify(record.handoff)}` : "";
    const recovery = record.recoverySummary ? `\n\n--- timeout recovery context ---\n${sanitizeSensitive(record.recoverySummary)}` : "";
    return `${task}${scope}${handoff}${recovery}`;
  }

  private subscribeSession(record: WorkerRecord, session: any, candidateId: string, configuredModel: string): () => void {
    if (typeof session?.subscribe !== "function") return () => {};
    return session.subscribe((event: any) => {
      if (event?.type === "message_end" && event.message?.role === "assistant" && event.message.usage && this.options.usageLedger) {
        const message = event.message;
        const model = typeof message.provider === "string" && typeof message.model === "string"
          ? `${message.provider}/${message.model}`
          : configuredModel;
        void appendUsageLedger(this.options.usageLedger.agentDir, {
          timestamp: message.timestamp,
          parentSessionId: this.options.usageLedger.parentSessionId,
          project: this.options.cwd,
          workerId: record.id,
          requestedTier: record.requestedTier,
          activeTier: record.activeTier,
          candidateId,
          model,
          usage: message.usage,
        }).catch((error) => this.signal(record, "usage_ledger_failed", { error: errorMessage(error) }));
      }
      if (isTerminal(record.state)) return;
      if (event?.type === "message_update") {
        const delta = event.assistantMessageEvent;
        if (delta?.type === "text_delta" && typeof delta.delta === "string") record.liveText = truncate(sanitizeSensitive(`${record.liveText ?? ""}${delta.delta}`), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (delta?.type === "text_end" && typeof delta.content === "string") record.liveText = truncate(sanitizeSensitive(delta.content), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (delta?.type === "thinking_delta" && typeof delta.delta === "string") record.liveThinking = truncate(sanitizeSensitive(`${record.liveThinking ?? ""}${delta.delta}`), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (delta?.type === "thinking_end" && typeof delta.content === "string") record.liveThinking = truncate(sanitizeSensitive(delta.content), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (["text_delta", "text_end", "thinking_delta", "thinking_end"].includes(delta?.type)) record.lastActivity = "生成文本";
      } else if (event?.type === "tool_execution_start" && typeof event.toolName === "string") {
        if (event.toolName !== SIGNAL_TOOL_NAME && event.toolName !== REPORT_TOOL_NAME) {
          record.toolCallCount += 1;
          if (record.toolCallCount > record.toolCallBudget && !record.toolLimitReached) {
            record.toolLimitReached = true;
            record.rejectToolLimit?.(new WorkerToolLimitError(toolBudgetExhaustedMessage(record)));
            void abortBounded(session);
          }
        }
        record.liveTool = truncate(sanitizeSensitive(event.toolName), 100);
        record.lastActivity = truncate(sanitizeSensitive(`运行工具 ${event.toolName}`), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
      } else if (event?.type === "tool_execution_end") {
        record.liveTool = undefined;
        record.lastActivity = "工具执行完成";
      }
      this.throttledChange(record);
    });
  }

  private throttledChange(record: WorkerRecord): void {
    const now = Date.now();
    const minIntervalMs = 100;
    if (record.lastRenderAt && now - record.lastRenderAt < minIntervalMs) {
      if (!record.pendingRender) {
        record.pendingRender = true;
        record.renderTimer = setTimeout(() => {
          record.renderTimer = undefined;
          record.pendingRender = false;
          if (this.closed || isTerminal(record.state)) return;
          record.lastRenderAt = Date.now();
          this.signalLog.setSnapshot(this.snapshot(record)!);
          this.notifyChange();
        }, minIntervalMs);
      }
      return;
    }
    record.lastRenderAt = now;
    this.signalLog.setSnapshot(this.snapshot(record)!);
    this.notifyChange();
  }

  private notifyChange(): void {
    try { this.options.onChange?.(); } catch { /* 外部渲染失败不能破坏 worker 生命周期 */ }
  }

  private readyForWait(workerIds: Set<string>): WorkerSnapshot[] {
    return [...workerIds]
      .map((workerId) => this.snapshot(this.records.get(workerId)))
      .filter((worker): worker is WorkerSnapshot => !!worker && (worker.state === "waiting" || isTerminal(worker.state)));
  }

  private waitResult(workerIds: Set<string>, reason: DteamWaitResult["reason"], startedAt: number, timeoutMs: number, events: ParentEvent[]): DteamWaitResult {
    const targetWorkers = [...workerIds].map((workerId) => {
      const worker = this.records.get(workerId)!;
      return { id: worker.id, title: worker.title };
    });
    const eventWorkerIds = new Set(events.map((event) => event.workerId));
    const ready = reason === "worker_event"
      ? [...eventWorkerIds].map((workerId) => this.snapshot(this.records.get(workerId))).filter((worker): worker is WorkerSnapshot => !!worker)
      : this.readyForWait(workerIds);
    const requests: WaitRequest[] = this.requestState.list()
      .filter((request) => workerIds.has(request.workerId))
      .map((request) => ({ workerId: request.workerId, requestId: request.requestId, kind: request.kind, payload: sanitizeUnknown(request.payload) }));
    const pendingWorkerIds = [...workerIds].filter((workerId) => !ready.some((worker) => worker.id === workerId));
    return { reason, targetWorkers, waitedMs: Math.max(0, Date.now() - startedAt), timeoutMs, events, ready, requests, pendingWorkerIds };
  }

  private consumeWaiterFor(event: ParentEvent): boolean {
    const waiter = [...this.waiters].find((candidate) => candidate.workerIds.has(event.workerId));
    if (!waiter) return false;
    this.settleWaiter(waiter, "worker_event", [event]);
    return true;
  }

  private consumePendingEventsFor(workerIds: Set<string>): ParentEvent[] {
    const consumed = this.pendingParentEvents.filter(({ event }) => workerIds.has(event.workerId));
    if (consumed.length > 0) this.pendingParentEvents = this.pendingParentEvents.filter(({ event }) => !workerIds.has(event.workerId));
    return consumed.map(({ event }) => event);
  }

  private settleWaiter(waiter: Waiter, reason: DteamWaitResult["reason"], events: ParentEvent[]): void {
    if (!this.waiters.delete(waiter)) return;
    clearTimeout(waiter.timer);
    waiter.resolve(this.waitResult(waiter.workerIds, reason, waiter.startedAt, waiter.timeoutMs, events));
  }

  private clearRenderTimer(record: WorkerRecord): void {
    if (record.renderTimer) clearTimeout(record.renderTimer);
    record.renderTimer = undefined;
    record.pendingRender = false;
  }

  private validateRequest(request: WorkerRequest): void {
    if (!request || typeof request.title !== "string" || !request.title.trim()) throw new Error("dteam: title 必须是非空字符串");
    if (typeof request.task !== "string" || !request.task.trim()) throw new Error("dteam: task 必须是非空字符串");
    if (request.task.length > DTEAM_CONFIG.dispatch.maxRecoverySummaryChars) throw new Error(`dteam: task 超过最大长度 ${DTEAM_CONFIG.dispatch.maxRecoverySummaryChars}`);
    if (!["T1", "T2", "T3"].includes(request.tier)) throw new Error("dteam: tier 必须是 T1、T2 或 T3");
    if (request.addTools !== undefined && (!Array.isArray(request.addTools) || !request.addTools.every((tool) => typeof tool === "string"))) throw new Error("dteam: addTools 必须是字符串数组");
    const writable = request.addTools?.some((tool) => tool === "edit" || tool === "write") ?? false;
    if (writable && (!Array.isArray(request.writeScope) || request.writeScope.length === 0)) throw new Error("dteam: 可写 worker 必须提供非空 writeScope");
    if (request.writeScope !== undefined && (!Array.isArray(request.writeScope) || !request.writeScope.every((item) => isProjectRelativePath(item)))) throw new Error("dteam: writeScope 必须是非空项目相对路径数组");
    if (request.handoff !== undefined) this.validateHandoff(request.handoff);
  }

  private validateHandoff(handoff: NonNullable<WorkerRequest["handoff"]>): void {
    const allowedKeys = new Set(["facts", "constraints", "uncertainties"]);
    if (Object.keys(handoff).some((key) => !allowedKeys.has(key))) throw new Error("dteam: handoff 只允许 facts、constraints 和 uncertainties");
    if (JSON.stringify(handoff).length > DTEAM_CONFIG.dispatch.maxHandoffChars) throw new Error(`dteam: handoff 超过最大长度 ${DTEAM_CONFIG.dispatch.maxHandoffChars}`);
    if (!Array.isArray(handoff.facts) || handoff.facts.length > DTEAM_CONFIG.dispatch.maxHandoffFacts || handoff.facts.some((fact) => !fact || typeof fact.claim !== "string" || !fact.claim.trim() || fact.claim.length > DTEAM_CONFIG.dispatch.maxHandoffFieldChars || typeof fact.evidence !== "string" || !fact.evidence.trim() || fact.evidence.length > DTEAM_CONFIG.dispatch.maxHandoffFieldChars || typeof fact.workerId !== "string" || !fact.workerId.trim() || fact.workerId.length > DTEAM_CONFIG.dispatch.maxHandoffFieldChars)) throw new Error("dteam: handoff.facts 必须是有界的 claim、evidence 和 workerId 数组");
    for (const key of ["constraints", "uncertainties"] as const) {
      if (handoff[key] !== undefined && (!Array.isArray(handoff[key]) || handoff[key].length > DTEAM_CONFIG.dispatch.maxHandoffItems || handoff[key].some((item) => typeof item !== "string" || !item.trim() || item.length > DTEAM_CONFIG.dispatch.maxHandoffFieldChars))) throw new Error(`dteam: handoff.${key} 必须是有界的非空字符串数组`);
    }
  }

  private sanitizeHandoff(handoff: NonNullable<WorkerRequest["handoff"]>): NonNullable<WorkerRequest["handoff"]> {
    const safe = (value: string) => truncate(sanitizeSensitive(value), DTEAM_CONFIG.dispatch.maxHandoffFieldChars);
    return {
      facts: handoff.facts.map((fact) => ({ claim: safe(fact.claim), evidence: safe(fact.evidence), workerId: safe(fact.workerId) })),
      ...(handoff.constraints ? { constraints: handoff.constraints.map(safe) } : {}),
      ...(handoff.uncertainties ? { uncertainties: handoff.uncertainties.map(safe) } : {}),
    };
  }

  private sanitizeReport(report: WorkerReport): WorkerReport {
    const safe = (value: string) => truncate(sanitizeSensitive(value), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    const facts = report.facts.map((fact) => ({ claim: safe(fact.claim), evidence: safe(fact.evidence) }));
    const remaining = report.verification.remaining?.map(safe);
    const uncertainties = report.uncertainties?.map(safe);
    return {
      outcome: report.outcome,
      summary: safe(report.summary),
      activities: [...report.activities],
      facts,
      verification: {
        depth: report.verification.depth,
        status: report.verification.status,
        evidence: report.verification.evidence.map(safe),
        ...(remaining?.length ? { remaining } : {}),
      },
      ...(uncertainties?.length ? { uncertainties } : {}),
    };
  }

  private reportWithProvenance(record: WorkerRecord) {
    const report = record.report!;
    return { ...report, facts: report.facts.map((fact) => ({ ...fact, workerId: record.id })) };
  }

  private emitWriteInterrupted(record: WorkerRecord, reason?: string, force = false, delivery: ParentEventDelivery = "follow_up"): WriteInterruptedGuard | undefined {
    if (!record.writeScope?.length || record.state === "completed") return undefined;
    const guard: WriteInterruptedGuard = { writeScope: [...record.writeScope] };
    if (reason !== undefined) guard.reason = reason;
    if (record.writeInterrupted && !force) return guard;
    record.writeInterrupted = true;
    this.signal(record, "write_interrupted", { reason, writeScope: guard.writeScope });
    this.emit({ type: "write_interrupted", workerId: record.id, title: record.title, payload: { reason, state: record.state, writeScope: guard.writeScope } }, delivery);
    return guard;
  }

  private signal(record: WorkerRecord, kind: string, payload: unknown): void {
    const safePayload = sanitizeUnknown(payload);
    this.signalLog.append({ signalId: crypto.randomUUID(), workerId: record.id, at: Date.now(), kind, payload: safePayload });
    this.signalLog.setSnapshot(this.snapshot(record)!);
    this.notifyChange();
  }
  private snapshot(record?: WorkerRecord): WorkerSnapshot | undefined {
    if (!record) return undefined;
    const safe = (value?: string) => value === undefined ? undefined : truncate(sanitizeSensitive(value), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    const diagnostic = record.timeoutDiagnostic ? { ...record.timeoutDiagnostic, lastActivity: safe(record.timeoutDiagnostic.lastActivity) ?? "", currentTool: safe(record.timeoutDiagnostic.currentTool) ?? "", outputSummary: safe(record.timeoutDiagnostic.outputSummary) ?? "" } : undefined;
    return { id: record.id, title: safe(record.title) ?? "", task: safe(record.task) ?? "", requestedTier: record.requestedTier, activeTier: record.activeTier, fallbackTrail: [...record.fallbackTrail], state: record.state, activeTools: [...record.activeTools], handoff: record.handoff, writeScope: record.writeScope, report: record.report, toolCallCount: record.toolCallCount, toolCallBudget: record.toolCallBudget, toolBudgetExtensionCount: record.toolBudgetExtensionCount, startedAt: record.startedAt, endedAt: record.endedAt, latestFinding: safe(record.latestFinding), liveText: safe(record.liveText), liveThinking: safe(record.liveThinking), liveTool: safe(record.liveTool), lastActivity: safe(record.lastActivity), timeoutDiagnostic: diagnostic, result: safe(record.result), error: safe(record.error), cancelReason: safe(record.cancelReason), terminalReason: record.terminalReason };
  }
  private emit(event: ParentEvent, delivery: ParentEventDelivery = "follow_up"): void {
    const safeEvent: ParentEvent = {
      ...event,
      title: truncate(sanitizeSensitive(event.title), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars),
      payload: sanitizeUnknown(event.payload),
    };
    if (this.consumeWaiterFor(safeEvent)) return;
    this.pendingParentEvents.push({ event: safeEvent, delivery });
    if (delivery === "wait_only") return;
    if (this.options.onParentEventAvailable) {
      try { this.options.onParentEventAvailable(); } catch { /* 可用性通知失败不能改变 worker 业务状态 */ }
    } else if (safeEvent.type === "completed") {
      this.parentEventTimer ??= setTimeout(() => this.flushParentEvents(), 500);
    } else {
      this.flushParentEvents();
    }
  }

  private discardPendingEventsFor(workerId: string): void {
    this.pendingParentEvents = this.pendingParentEvents.filter(({ event }) => event.workerId !== workerId);
    if (this.parentEventTimer && !this.pendingParentEvents.some(({ delivery }) => delivery === "follow_up")) {
      clearTimeout(this.parentEventTimer);
      this.parentEventTimer = undefined;
    }
  }

  /** 把仍未被 dteam_wait 消费且允许 follow-up 的事件交给主代理；调用后事件不可再次消费。 */
  flushParentEvents(): void {
    if (this.parentEventTimer) clearTimeout(this.parentEventTimer);
    this.parentEventTimer = undefined;
    if (this.pendingParentEvents.length === 0) return;
    const events = this.pendingParentEvents
      .filter(({ delivery }) => delivery === "follow_up")
      .map(({ event }) => event);
    this.pendingParentEvents = this.pendingParentEvents.filter(({ delivery }) => delivery === "wait_only");
    const completed = events.filter((event) => event.type === "completed");
    const other = events.filter((event) => event.type !== "completed");
    for (const event of other) this.deliverParentEvent(event);
    if (completed.length === 1) this.deliverParentEvent(completed[0]!);
    else if (completed.length > 1) {
      this.deliverParentEvent({
        type: "completed",
        workerId: "multiple",
        title: "dteam workers",
        payload: { results: completed.map((item) => ({ workerId: item.workerId, title: item.title, ...(item.payload as object) })) },
      });
    }
  }

  private deliverParentEvent(event: ParentEvent): void {
    try { this.options.onParentEvent?.(event); } catch { /* 父代理通知失败不能改变 worker 业务状态 */ }
  }

}

class WorkerTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = "WorkerTimeoutError"; }
}

class WorkerNoOutputError extends Error {
  constructor(message: string) { super(message); this.name = "WorkerNoOutputError"; }
}

class WorkerToolLimitError extends Error {
  constructor(message: string) { super(message); this.name = "WorkerToolLimitError"; }
}

async function createSessionWithTimeout(options: Parameters<typeof createWorkerSession>[0], configuredTimeoutMs?: number, signal?: AbortSignal): Promise<any> {
  const timeoutMs = configuredTimeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs;
  const creation = Promise.resolve(createWorkerSession(options));
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  return new Promise<any>((resolve, reject) => {
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      if (timer) clearTimeout(timer);
      if (onAbort && signal) signal.removeEventListener("abort", onAbort);
      callback();
    };
    onAbort = () => finish(() => reject(new Error("dteam: worker 已取消")));
    if (signal?.aborted) { onAbort(); return; }
    signal?.addEventListener("abort", onAbort, { once: true });
    timer = setTimeout(() => finish(() => reject(new WorkerTimeoutError(`worker session 创建超时（${formatDuration(timeoutMs)}）`))), timeoutMs);
    void creation.then(
      (session) => { if (settled) { void closeSession(session); return; } finish(() => resolve(session)); },
      (error) => finish(() => reject(error instanceof Error ? error : new Error(String(error)))),
    );
  });
}

async function abortBounded(session: any): Promise<void> {
  if (!session?.abort) return;
  try {
    const result = session.abort();
    await Promise.race([
      Promise.resolve(result).catch(() => undefined),
      new Promise<void>((resolve) => setTimeout(resolve, DTEAM_CONFIG.dispatch.abortGraceMs)),
    ]);
  } catch { /* abort 失败不能阻止终态或回退 */ }
}

async function closeSession(session: any): Promise<void> {
  if (!session) return;
  await abortBounded(session);
  try { session.dispose?.(); } catch { /* dispose 失败不能阻止终态或回退 */ }
}

function responseAllowed(requestKind: string, responseType: ParentResponse["type"]): boolean {
  if (requestKind === "timeout_recovery") return false;
  if (responseType === "deny") return true;
  if (responseType === "cancel") return true;
  if (requestKind === "request_context") return responseType === "provide_context";
  if (requestKind === "request_tools") return responseType === "grant_tools";
  if (requestKind === "request_tool_budget") return responseType === "grant_tool_budget";
  if (requestKind === "request_decision" || requestKind === "blocked") return responseType === "decision";
  return false;
}

function isTerminal(state: WorkerSnapshot["state"]): boolean {
  return ["completed", "failed", "timed_out", "cancelled", "shutdown"].includes(state);
}

function isNextTier(current: Tier, next: Tier): boolean {
  return (current === "T3" && next === "T2") || (current === "T2" && next === "T1");
}

function toolCallBudgetForTier(tier: Tier): number {
  return DTEAM_CONFIG.dispatch.toolCallBudgetByTier[tier];
}

function needsCompactionResync(record: WorkerRecord): boolean {
  if (["queued", "running", "waiting"].includes(record.state)) return true;
  if (record.state !== "completed") return true;
  const report = record.report;
  return Boolean(report && (report.outcome === "partial" || report.verification.status !== "passed" || report.verification.remaining?.length || report.uncertainties?.length));
}

function formatCompactionResyncRecord(record: WorkerRecord): string[] {
  const safe = (value: string) => truncate(sanitizeSensitive(value), DTEAM_CONFIG.dispatch.maxHandoffFieldChars);
  const scope = record.writeScope?.length ? record.writeScope.map(safe).join(", ") : "未声明";
  const lines = [
    `- worker ${safe(record.id)} · ${safe(record.title)} · state=${record.state}`,
    `  局部 writeScope（仅此 worker）：${scope}`,
  ];
  const report = record.report;
  if (report) {
    lines.push(`  报告：${report.outcome}；验证：${report.verification.depth}/${report.verification.status}`);
    const fact = report.facts[0];
    if (fact) lines.push(`  事实：${safe(fact.claim)} ← ${safe(fact.evidence)}`);
    for (const remaining of report.verification.remaining ?? []) lines.push(`  剩余：${safe(remaining)}`);
    for (const uncertainty of report.uncertainties ?? []) lines.push(`  不确定：${safe(uncertainty)}`);
  }
  if (record.error) lines.push(`  错误：${safe(record.error)}`);
  return lines;
}

function workerSystemPrompt(tier: Tier, toolCallBudget: number): string {
  return `${getTierPrompt(tier)}\n\n本 worker 的工作工具调用额度为 ${toolCallBudget} 次；dteam_signal 和 dteam_report 不计入。若预计额度不足，必须在耗尽前调用 dteam_signal(kind=\"request_tool_budget\", requestId, reason) 请求主代理决定。主代理最多只会追加一次，且追加后再次不足时会结束本 worker，由主代理重新 dispatch fresh worker。\n\n若发现缺少完成任务所需的核心能力（如写文件或执行命令的工具），应立即调用 dteam_signal(kind=\"blocked\", requestId, reason) 报告并等待主代理决策；不要在能力缺失时空转或反复尝试。\n\n结束前必须恰好调用一次 dteam_report({ outcome, summary, activities, facts, verification, uncertainties? })。outcome 只表达任务本身 completed/partial；activities 只列本轮实际做过的 inspected/modified/tested/executed/captured_visual；facts 至少一项且每项包含 claim 与可核验 evidence；verification 必填，只报告实际达到的 depth(none/inspection/automated/runtime/visual)、status(passed/failed/partial/not_run)、evidence[] 与 remaining?。没有验证时必须使用 none + not_run + 空 evidence；inspection/automated/runtime/visual 分别要求 inspected/tested/executed/(executed + captured_visual)。不要把人工复测或期望深度写进报告。未提交合法报告会按失败处理。`;
}

function toolBudgetExhaustedMessage(record: WorkerRecord): string {
  if (record.toolBudgetExtensionCount >= DTEAM_CONFIG.dispatch.toolCallBudgetExtension.maxPerWorker) {
    return "worker 工具调用额度已追加一次仍耗尽；主代理应重新 dispatch fresh worker";
  }
  return "worker 工具调用额度已耗尽；worker 未在耗尽前请求主代理追加额度";
}

export { sanitizeSensitive, sanitizeUnknown };

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }

function isProjectRelativePath(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0 && !value.startsWith("/") && !value.split(/[\\/]+/).includes("..");
}

/** 兼容 AgentSession 在 prompt 结束后才落入历史的结构化工具调用；绝不解析自由文本。 */
function reportFromMessages(messages: any[]): WorkerReport | undefined {
  for (const message of [...messages].reverse()) {
    if (message?.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const content of [...message.content].reverse()) {
      if (content?.type !== "toolCall" || content.name !== REPORT_TOOL_NAME) continue;
      const raw = typeof content.arguments === "string" ? tryParseJson(content.arguments) : content.arguments;
      try { return parseWorkerReport(raw); } catch { /* 忽略无效工具调用，继续寻找最近的合法报告。 */ }
    }
  }
  return undefined;
}

function tryParseJson(value: string): unknown {
  try { return JSON.parse(value); } catch { return undefined; }
}
