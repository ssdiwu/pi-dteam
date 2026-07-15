import { DTEAM_CONFIG } from "../config.js";
import { formatDuration } from "../duration.js";
import { AdaptiveConcurrency } from "../dispatch/concurrency.js";
import { isRateLimitError, tierModelCandidates } from "../dispatch/model-routing.js";
import { getTierPrompt, getTierTools, parseTierModelCandidate, tierModelRoutesFromEnv } from "../session/tier-config.js";
import { createWorkerSession } from "../session.js";
import { extractLastText } from "../leaf/extract.js";
import type { Tier, TierModelRoutes } from "../types/dispatch.js";
import { createToolPolicy, validateRequestedTools } from "./tool-policy.js";
import { RequestState } from "./request-state.js";
import { SignalLog } from "./signal-log.js";
import { makeSignalTool } from "./signal-tool.js";
import { MAX_WORKERS_PER_DISPATCH, SIGNAL_TOOL_NAME, type DispatchAccepted, type ParentEvent, type ParentResponse, type TimeoutDiagnostic, type WorkerRequest, type WorkerSignal, type WorkerSnapshot } from "./types.js";

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
  onParentEvent?: (event: ParentEvent) => void;
  onChange?: () => void;
}

/** 当前 Pi 会话唯一的 worker 生命周期所有者；不理解依赖，也不保存 batch。 */
export class WorkerManager {
  readonly signalLog = new SignalLog();
  readonly requestState = new RequestState();
  private readonly records = new Map<string, WorkerRecord>();
  private readonly options: WorkerManagerOptions;
  private completedBuffer: ParentEvent[] = [];
  private completionTimer: ReturnType<typeof setTimeout> | undefined;
  private closed = false;

  constructor(options: WorkerManagerOptions) { this.options = options; }

  dispatch(requests: WorkerRequest[]): DispatchAccepted[] {
    if (this.closed) throw new Error("dteam: session runtime 已关闭");
    if (!Array.isArray(requests) || requests.length < 1 || requests.length > MAX_WORKERS_PER_DISPATCH) throw new Error("dteam: workers 数量必须是 1–32");
    const accepted: DispatchAccepted[] = [];
    const parentActiveTools = this.options.getParentActiveTools?.() ?? this.options.parentActiveTools;
    const prepared = requests.map((request) => {
      this.validateRequest(request);
      const baseTools = getTierTools(request.tier);
      const policy = createToolPolicy({ baseTools, addTools: request.addTools, parentActiveTools, signalToolName: SIGNAL_TOOL_NAME });
      return { request, policy };
    });
    for (const { request, policy } of prepared) {
      const id = crypto.randomUUID();
      const record: WorkerRecord = {
        id, title: request.title.trim(), task: request.task.trim(), requestedTier: request.tier, activeTier: request.tier,
        fallbackTrail: [], state: "queued", activeTools: policy.initialActiveTools, controller: new AbortController(), policy,
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

  respond(workerId: string, requestId: string, response: ParentResponse): { workerId: string; requestId: string; state: string } {
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
    } else {
      this.signal(record, response.type, response);
    }
    this.requestState.respond(workerId, requestId, response);
    if (pending.kind === "timeout_recovery") return { workerId, requestId, state: record.state };
    if (!this.requestState.list().some((request) => request.workerId === workerId)) record.state = "running";
    this.signal(record, "worker_resumed", { requestId, remainingRequests: this.requestState.list().filter((request) => request.workerId === workerId).length });
    return { workerId, requestId, state: record.state };
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

  cancel(workerId: string, reason = "user_cancelled"): void {
    const record = this.records.get(workerId);
    if (!record || isTerminal(record.state)) throw new Error("dteam: worker 已结束或不存在");
    record.cancelReason = reason;
    record.terminalReason = "user_cancelled";
    record.state = "cancelled";
    record.endedAt ??= Date.now();
    this.requestState.cancelWorker(workerId, reason);
    record.controller.abort();
    this.clearRenderTimer(record);
    void abortBounded(record.session);
    this.signal(record, "worker_cancelled", { reason });
    this.emit({ type: "cancelled", workerId, title: record.title, payload: { reason, state: record.state } });
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
    void abortBounded(record.session);
    this.signal(record, "worker_shutdown", { reason: "session_shutdown" });
    this.emit({ type: "cancelled", workerId: record.id, title: record.title, payload: { reason: "session_shutdown", state: record.state } });
  }

  shutdown(): void {
    if (this.closed) return;
    this.closed = true;
    for (const record of this.records.values()) {
      if (!isTerminal(record.state)) this.shutdownWorker(record);
    }
    this.requestState.clear();
    if (this.completionTimer) {
      clearTimeout(this.completionTimer);
      this.completionTimer = undefined;
      this.completedBuffer = [];
    }
  }

  get(workerId: string): WorkerSnapshot | undefined { return this.snapshot(this.records.get(workerId)); }
  list(): WorkerSnapshot[] { return [...this.records.values()].map((record) => this.snapshot(record)!); }
  active(): WorkerSnapshot[] { return this.list().filter((record) => ["queued", "running", "waiting"].includes(record.state)); }

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
      record.state = "running";
      record.startedAt ??= Date.now();
      if (record.fallbackTrail.at(-1) !== record.activeTier) record.fallbackTrail.push(record.activeTier);
      record.lastActivity = "开始执行";
      record.attemptConsumedMs = 0;
      this.signal(record, "attempt_started", { tier: record.activeTier, budgetMs: record.attemptBudgetMs });
      const result = await this.runTierCandidates(record);
      if (isTerminal(record.state)) return;
      record.state = "completed"; record.result = result; record.endedAt = Date.now();
      await abortBounded(record.session);
      record.session = undefined;
      this.signal(record, "worker_completed", { result });
      this.emitCompleted({ type: "completed", workerId: record.id, title: record.title, payload: { result, tier: record.activeTier, fallbackTrail: record.fallbackTrail } });
    } catch (error) {
      if (isTerminal(record.state) || record.controller.signal.aborted) return;
      if (error instanceof WorkerTimeoutError) {
        this.requestTimeoutRecovery(record, error);
        return;
      }
      record.state = "failed";
      record.terminalReason = "error";
      record.error = truncate(sanitizeSensitive(errorMessage(error)), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars); record.endedAt = Date.now();
      this.signal(record, "worker_failed", { error: record.error });
      this.emit({ type: "failed", workerId: record.id, title: record.title, payload: { error: record.error, state: record.state } });
    } finally {
      if (acquired) this.options.concurrency.release(record.state === "completed");
    }
  }

  private async runTierCandidates(record: WorkerRecord): Promise<string> {
    const tier = record.activeTier;
    let lastError: unknown;
    for (const candidate of tierModelCandidates(tier, this.options.model, this.options.tierModelRoutes ?? tierModelRoutesFromEnv())) {
      const { modelStr, thinkingLevel } = parseTierModelCandidate(candidate, tier);
      const remainingBudget = record.attemptBudgetMs - record.attemptConsumedMs;
      if (remainingBudget <= 0) throw new WorkerTimeoutError(`worker 累计预算已用尽（${formatDuration(record.totalBudgetMs)}）`);
      const attemptBudgetMs = Math.min(record.attemptBudgetMs, remainingBudget);
      const creationStartedAt = Date.now();
      let creationAccounted = false;
      try {
        const session = await createSessionWithTimeout({
          tier, cwd: this.options.cwd, modelStr, ctx: { modelRegistry: this.options.modelRegistry },
          systemPrompt: workerSystemPrompt(tier, record.toolCallBudget),
          builtInTools: getTierTools(tier),
          registeredTools: [...new Set([...getTierTools(tier), ...record.policy.addTools, SIGNAL_TOOL_NAME])],
          initialActiveTools: record.activeTools,
          customTools: [makeSignalTool(record.id, this)],
          thinkingLevel,
          logicalIsolation: true,
        }, attemptBudgetMs, record.controller.signal);
        const creationElapsed = Math.max(0, Date.now() - creationStartedAt);
        record.attemptConsumedMs += creationElapsed;
        record.consumedMs += creationElapsed;
        if (record.timeoutRecoveryCount > 0) record.recoveryConsumedMs += creationElapsed;
        creationAccounted = true;
        if (record.attemptConsumedMs >= record.attemptBudgetMs) throw new WorkerTimeoutError(`worker attempt 预算已用尽（${formatDuration(record.attemptBudgetMs)}）`);
        record.session = session;
        record.liveText = undefined;
        record.liveThinking = undefined;
        record.liveTool = undefined;
        const unsubscribe = this.subscribeSession(record, session);
        try {
          if (record.controller.signal.aborted || isTerminal(record.state)) {
            await abortBounded(session);
            throw new Error("dteam: worker 已取消");
          }
          const remainingAttemptBudget = record.attemptBudgetMs - record.attemptConsumedMs;
          if (remainingAttemptBudget <= 0) throw new WorkerTimeoutError(`worker 累计预算已用尽（${formatDuration(record.totalBudgetMs)}）`);
          return await this.promptWithTimeout(record, session, remainingAttemptBudget);
        } finally {
          unsubscribe();
        }
      } catch (error) {
        if (!creationAccounted) {
          const creationElapsed = Math.max(0, Date.now() - creationStartedAt);
          record.attemptConsumedMs += creationElapsed;
          record.consumedMs += creationElapsed;
          if (record.timeoutRecoveryCount > 0) record.recoveryConsumedMs += creationElapsed;
        }
        lastError = error;
        if (record.toolLimitReached) throw new WorkerToolLimitError(toolBudgetExhaustedMessage(record));
        if (record.controller.signal.aborted || error instanceof WorkerTimeoutError) throw error;
        await abortBounded(record.session);
        record.session = undefined;
        this.requestState.cancelWorker(record.id, "worker_attempt_failed");
        if (!isTerminal(record.state)) record.state = "running";
        if (isRateLimitError(error)) this.options.concurrency.recordRateLimit();
      }
    }
    throw lastError instanceof Error ? lastError : new Error("dteam: 所有模型候选均失败");
  }

  private async promptWithTimeout(record: WorkerRecord, session: any, timeoutMs: number): Promise<string> {
    const startedAt = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    let timedOut = false;
    let timeoutError: WorkerTimeoutError | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        timeoutError = new WorkerTimeoutError(`worker 执行超时（${formatDuration(timeoutMs)}）`);
        void abortBounded(session).then(() => reject(timeoutError));
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
      const result = extractLastText(session.messages as any[]);
      if (result === "(no output)") throw new Error("worker 未返回 assistant 文本");
      return truncate(sanitizeSensitive(result), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
    } finally {
      const promptElapsed = Math.max(0, Date.now() - startedAt);
      record.attemptConsumedMs += promptElapsed;
      record.consumedMs += promptElapsed;
      if (record.timeoutRecoveryCount > 0) record.recoveryConsumedMs += promptElapsed;
      if (timer) clearTimeout(timer);
      if (onAbort) record.controller.signal.removeEventListener("abort", onAbort);
      if (record.rejectToolLimit === rejectToolLimit) record.rejectToolLimit = undefined;
    }
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
    void waiting.then(
      (response) => this.applyTimeoutRecovery(record, response),
      (recoveryError) => this.stopTimedOut(record, errorMessage(recoveryError)),
    );
  }

  private applyTimeoutRecovery(record: WorkerRecord, response: ParentResponse): void {
    if (isTerminal(record.state) || record.controller.signal.aborted) return;
    if (response.type === "stop" || response.type === "deny") {
      this.stopTimedOut(record, response.reason);
      return;
    }
    if (!["retry", "escalate", "extend"].includes(response.type)) {
      this.stopTimedOut(record, "timeout recovery 收到不支持的回应");
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
    if (response.type === "escalate") {
      if (!isNextTier(tier, response.tier)) {
        this.stopTimedOut(record, `不允许从 ${tier} 升级到 ${response.tier}`);
        return;
      }
      tier = response.tier;
      record.activeTools = [...new Set([...getTierTools(tier), SIGNAL_TOOL_NAME])];
    }
    if (response.type === "extend") {
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
    record.timeoutRecoveryCount += 1;
    record.activeTier = tier;
    record.totalBudgetMs = budgetMs;
    record.attemptBudgetMs = budgetMs;
    record.attemptConsumedMs = 0;
    record.recoverySummary = this.buildRecoverySummary(record);
    record.timeoutDiagnostic = undefined;
    record.error = undefined;
    record.endedAt = undefined;
    record.state = "queued";
    this.signal(record, "worker_recovery_started", { action: response.type, tier, budgetMs, recoveryCount: record.timeoutRecoveryCount });
    void this.run(record);
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
    void abortBounded(record.session);
    this.signal(record, "worker_tool_budget_exhausted", { reason, toolCallCount: record.toolCallCount, toolCallBudget: record.toolCallBudget });
    this.emit({ type: "failed", workerId: record.id, title: record.title, payload: { error: reason, state: record.state, toolCallCount: record.toolCallCount, toolCallBudget: record.toolCallBudget } });
  }

  private stopTimedOut(record: WorkerRecord, reason?: string): void {
    if (isTerminal(record.state)) return;
    record.state = "timed_out";
    record.terminalReason = "timeout";
    record.error = reason ?? `worker 执行超时（${formatDuration(record.attemptBudgetMs)}）`;
    record.endedAt = Date.now();
    this.signal(record, "worker_timed_out", { error: record.error, diagnostic: record.timeoutDiagnostic });
    this.emit({ type: "failed", workerId: record.id, title: record.title, payload: { error: record.error, state: record.state, diagnostic: record.timeoutDiagnostic } });
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
    return record.recoverySummary ? `${task}\n\n--- timeout recovery context ---\n${sanitizeSensitive(record.recoverySummary)}` : task;
  }

  private subscribeSession(record: WorkerRecord, session: any): () => void {
    if (typeof session?.subscribe !== "function") return () => {};
    return session.subscribe((event: any) => {
      if (isTerminal(record.state)) return;
      if (event?.type === "message_update") {
        const delta = event.assistantMessageEvent;
        if (delta?.type === "text_delta" && typeof delta.delta === "string") record.liveText = truncate(sanitizeSensitive(`${record.liveText ?? ""}${delta.delta}`), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (delta?.type === "text_end" && typeof delta.content === "string") record.liveText = truncate(sanitizeSensitive(delta.content), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (delta?.type === "thinking_delta" && typeof delta.delta === "string") record.liveThinking = truncate(sanitizeSensitive(`${record.liveThinking ?? ""}${delta.delta}`), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (delta?.type === "thinking_end" && typeof delta.content === "string") record.liveThinking = truncate(sanitizeSensitive(delta.content), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
        if (["text_delta", "text_end", "thinking_delta", "thinking_end"].includes(delta?.type)) record.lastActivity = "生成文本";
      } else if (event?.type === "tool_execution_start" && typeof event.toolName === "string") {
        if (event.toolName !== SIGNAL_TOOL_NAME) {
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
    return { id: record.id, title: safe(record.title) ?? "", task: safe(record.task) ?? "", requestedTier: record.requestedTier, activeTier: record.activeTier, fallbackTrail: [...record.fallbackTrail], state: record.state, activeTools: [...record.activeTools], toolCallCount: record.toolCallCount, toolCallBudget: record.toolCallBudget, toolBudgetExtensionCount: record.toolBudgetExtensionCount, startedAt: record.startedAt, endedAt: record.endedAt, latestFinding: safe(record.latestFinding), liveText: safe(record.liveText), liveThinking: safe(record.liveThinking), liveTool: safe(record.liveTool), lastActivity: safe(record.lastActivity), timeoutDiagnostic: diagnostic, result: safe(record.result), error: safe(record.error), cancelReason: safe(record.cancelReason), terminalReason: record.terminalReason };
  }
  private emit(event: ParentEvent): void {
    const safeEvent: ParentEvent = {
      ...event,
      title: truncate(sanitizeSensitive(event.title), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars),
      payload: sanitizeUnknown(event.payload),
    };
    try { this.options.onParentEvent?.(safeEvent); } catch { /* 父代理通知失败不能改变 worker 业务状态 */ }
  }
  private emitCompleted(event: ParentEvent): void {
    this.completedBuffer.push(event);
    if (this.completionTimer) return;
    this.completionTimer = setTimeout(() => {
      const events = this.completedBuffer.splice(0);
      this.completionTimer = undefined;
      this.emit({
        type: "completed",
        workerId: events.length === 1 ? events[0]!.workerId : "multiple",
        title: events.length === 1 ? events[0]!.title : "dteam workers",
        payload: events.length === 1 ? events[0]!.payload : { results: events.map((item) => ({ workerId: item.workerId, title: item.title, ...(item.payload as object) })) },
      });
    }, 500);
  }
}

class WorkerTimeoutError extends Error {
  constructor(message: string) { super(message); this.name = "WorkerTimeoutError"; }
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
      (session) => { if (settled) { void abortBounded(session); return; } finish(() => resolve(session)); },
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

function responseAllowed(requestKind: string, responseType: ParentResponse["type"]): boolean {
  if (responseType === "deny") return true;
  if (requestKind === "request_context") return responseType === "provide_context";
  if (requestKind === "request_tools") return responseType === "grant_tools";
  if (requestKind === "request_tool_budget") return responseType === "grant_tool_budget";
  if (requestKind === "request_decision" || requestKind === "blocked") return responseType === "decision";
  if (requestKind === "timeout_recovery") return ["retry", "escalate", "extend", "stop"].includes(responseType);
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

function workerSystemPrompt(tier: Tier, toolCallBudget: number): string {
  return `${getTierPrompt(tier)}\n\n本 worker 的工作工具调用额度为 ${toolCallBudget} 次；dteam_signal 不计入。若预计额度不足，必须在耗尽前调用 dteam_signal(kind=\"request_tool_budget\", requestId, reason) 请求主代理决定。主代理最多只会追加一次，且追加后再次不足时会结束本 worker，由主代理重新 dispatch fresh worker。`;
}

function toolBudgetExhaustedMessage(record: WorkerRecord): string {
  if (record.toolBudgetExtensionCount >= DTEAM_CONFIG.dispatch.toolCallBudgetExtension.maxPerWorker) {
    return "worker 工具调用额度已追加一次仍耗尽；主代理应重新 dispatch fresh worker";
  }
  return "worker 工具调用额度已耗尽；worker 未在耗尽前请求主代理追加额度";
}

function truncate(value: string, maxChars: number): string {
  return value.length <= maxChars ? value : `${value.slice(0, Math.max(0, maxChars - 1))}…`;
}

export function sanitizeSensitive(value: string): string {
  return value
    .replace(/-----BEGIN [^-]+ KEY-----[\s\S]*?-----END [^-]+ KEY-----/gi, "[REDACTED_KEY]")
    .replace(/\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9_\-]{16,}|github_pat_[A-Za-z0-9_\-]{16,}|xox[baprs]-[A-Za-z0-9-]{16,}|AKIA[0-9A-Z]{16})\b/g, "[REDACTED_SECRET]")
    .replace(/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, "Bearer [REDACTED_SECRET]")
    .replace(/(\b(?:https?|postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^:\s/@]+:)([^@\s]+)(@)/gi, "$1[REDACTED_SECRET]$3")
    .replace(/((?:api[_-]?key|secret|token|password|authorization|database[_-]?url|connection[_-]?string)\s*[:=]\s*)([\"']?)[^\s,;]+/gi, "$1$2[REDACTED_SECRET]");
}

export function sanitizeUnknown(value: unknown, depth = 0): unknown {
  if (depth > 4) return "[TRUNCATED]";
  if (typeof value === "string") return truncate(sanitizeSensitive(value), DTEAM_CONFIG.dispatch.maxRecoverySummaryChars);
  if (Array.isArray(value)) return value.slice(0, 32).map((item) => sanitizeUnknown(item, depth + 1));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 64).map(([key, item]) => [key, sanitizeUnknown(item, depth + 1)]));
  return value;
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
