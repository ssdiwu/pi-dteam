import { DTEAM_CONFIG } from "../config.js";
import { AdaptiveConcurrency } from "../dispatch/concurrency.js";
import { isRateLimitError, tierModelCandidates } from "../dispatch/model-routing.js";
import { getTierThinking, getTierTools, tierModelRoutesFromEnv } from "../session/tier-config.js";
import { createWorkerSession } from "../session.js";
import { extractLastText } from "../leaf/extract.js";
import type { Tier, TierModelRoutes } from "../types/dispatch.js";
import { createToolPolicy, validateRequestedTools } from "./tool-policy.js";
import { RequestState } from "./request-state.js";
import { SignalLog } from "./signal-log.js";
import { makeSignalTool } from "./signal-tool.js";
import { MAX_WORKERS_PER_DISPATCH, SIGNAL_TOOL_NAME, type DispatchAccepted, type ParentEvent, type ParentResponse, type WorkerRequest, type WorkerSignal, type WorkerSnapshot } from "./types.js";

interface WorkerRecord extends WorkerSnapshot {
  controller: AbortController;
  session?: any;
  policy: ReturnType<typeof createToolPolicy>;
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
      record.session?.setActiveToolsByName([...record.activeTools, ...tools]);
      record.activeTools = [...new Set([...record.activeTools, ...tools])];
      this.signal(record, "grant_tools", { tools });
    } else {
      this.signal(record, response.type, response);
    }
    this.requestState.respond(workerId, requestId, response);
    if (!this.requestState.list().some((request) => request.workerId === workerId)) record.state = "running";
    this.signal(record, "worker_resumed", { requestId, remainingRequests: this.requestState.list().filter((request) => request.workerId === workerId).length });
    return { workerId, requestId, state: record.state };
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
    this.requestState.cancelWorker(workerId, reason);
    record.controller.abort();
    void abortBounded(record.session);
    this.signal(record, "worker_cancelled", { reason });
    this.emit({ type: "cancelled", workerId, title: record.title, payload: { reason, state: record.state } });
  }

  private shutdownWorker(record: WorkerRecord): void {
    if (isTerminal(record.state)) return;
    record.cancelReason = "session_shutdown";
    record.terminalReason = "session_shutdown";
    record.state = "shutdown";
    this.requestState.cancelWorker(record.id, "session_shutdown");
    record.controller.abort();
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
    if (signal.kind === "progress") return { ok: true };
    if (signal.kind === "finding") {
      record.latestFinding = signal.summary;
      this.signalLog.setSnapshot(this.snapshot(record)!);
      return { ok: true };
    }
    record.state = "waiting";
    this.signal(record, "worker_waiting", { requestId: signal.requestId, kind: signal.kind });
    const waiting = this.requestState.wait({ workerId, requestId: signal.requestId, kind: signal.kind, payload: signal });
    this.emit({ type: "request", workerId, title: record.title, payload: signal });
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
      record.state = "running"; record.startedAt = Date.now();
      this.signal(record, "worker_started", {});
      const result = await this.runAttempts(record);
      if (isTerminal(record.state)) return;
      record.state = "completed"; record.result = result; record.endedAt = Date.now();
      await abortBounded(record.session);
      record.session = undefined;
      this.signal(record, "worker_completed", { result });
      this.emitCompleted({ type: "completed", workerId: record.id, title: record.title, payload: { result, tier: record.activeTier, fallbackTrail: record.fallbackTrail } });
    } catch (error) {
      if (isTerminal(record.state) || record.controller.signal.aborted) return;
      record.state = error instanceof WorkerTimeoutError ? "timed_out" : "failed";
      record.terminalReason = error instanceof WorkerTimeoutError ? "timeout" : "error";
      record.error = errorMessage(error); record.endedAt = Date.now();
      this.signal(record, record.state === "timed_out" ? "worker_timed_out" : "worker_failed", { error: record.error });
      this.emit({ type: "failed", workerId: record.id, title: record.title, payload: { error: record.error, state: record.state } });
    } finally {
      if (acquired) this.options.concurrency.release(record.state === "completed");
    }
  }

  private async runAttempts(record: WorkerRecord): Promise<string> {
    const attempts: Tier[] = record.requestedTier === "T1" ? ["T1"] : [record.requestedTier, "T1"];
    let lastError: unknown;
    for (const tier of attempts) {
      record.activeTier = tier;
      record.fallbackTrail.push(tier);
      if (tier !== record.requestedTier) this.signal(record, "fallback_started", { tier });
      for (const modelStr of tierModelCandidates(tier, this.options.model, this.options.tierModelRoutes ?? tierModelRoutesFromEnv())) {
        try {
          const session = await createSessionWithTimeout({
            tier, cwd: this.options.cwd, modelStr, ctx: { modelRegistry: this.options.modelRegistry },
            builtInTools: getTierTools(record.requestedTier),
            registeredTools: [...new Set([...record.policy.baseTools, ...record.policy.addTools, SIGNAL_TOOL_NAME])],
            initialActiveTools: record.activeTools,
            customTools: [makeSignalTool(record.id, this)],
            thinkingLevel: getTierThinking(tier),
            logicalIsolation: true,
          }, this.options.timeoutMs);
          record.session = session;
          if (record.controller.signal.aborted || isTerminal(record.state)) {
            await abortBounded(session);
            throw new Error("dteam: worker 已取消");
          }
          const output = await this.promptWithTimeout(record, session);
          if (tier !== record.requestedTier) this.signal(record, "fallback_completed", { tier });
          return output;
        } catch (error) {
          lastError = error;
          if (record.controller.signal.aborted) throw error;
          await abortBounded(record.session);
          record.session = undefined;
          this.requestState.cancelWorker(record.id, "worker_attempt_failed");
          if (!isTerminal(record.state)) record.state = "running";
          if (isRateLimitError(error)) this.options.concurrency.recordRateLimit();
        }
      }
    }
    throw lastError instanceof Error ? lastError : new Error("dteam: 所有模型尝试均失败");
  }

  private async promptWithTimeout(record: WorkerRecord, session: any): Promise<string> {
    const timeoutMs = this.options.timeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { void abortBounded(session).then(() => reject(new WorkerTimeoutError(`worker 执行超时（${timeoutMs}ms）`))); }, timeoutMs);
    });
    const cancelled = new Promise<never>((_, reject) => {
      onAbort = () => reject(new Error("dteam: worker 已取消"));
      if (record.controller.signal.aborted) onAbort();
      else record.controller.signal.addEventListener("abort", onAbort, { once: true });
    });
    try {
      await Promise.race([session.prompt(record.task), timeout, cancelled]);
      const result = extractLastText(session.messages as any[]);
      if (result === "(no output)") throw new Error("worker 未返回 assistant 文本");
      return result;
    } finally {
      if (timer) clearTimeout(timer);
      if (onAbort) record.controller.signal.removeEventListener("abort", onAbort);
    }
  }

  private validateRequest(request: WorkerRequest): void {
    if (!request || typeof request.title !== "string" || !request.title.trim()) throw new Error("dteam: title 必须是非空字符串");
    if (typeof request.task !== "string" || !request.task.trim()) throw new Error("dteam: task 必须是非空字符串");
    if (!["T1", "T2", "T3"].includes(request.tier)) throw new Error("dteam: tier 必须是 T1、T2 或 T3");
    if (request.addTools !== undefined && (!Array.isArray(request.addTools) || !request.addTools.every((tool) => typeof tool === "string"))) throw new Error("dteam: addTools 必须是字符串数组");
  }

  private signal(record: WorkerRecord, kind: string, payload: unknown): void {
    this.signalLog.append({ signalId: crypto.randomUUID(), workerId: record.id, at: Date.now(), kind, payload });
    this.signalLog.setSnapshot(this.snapshot(record)!);
    this.options.onChange?.();
  }
  private snapshot(record?: WorkerRecord): WorkerSnapshot | undefined {
    if (!record) return undefined;
    return { id: record.id, title: record.title, task: record.task, requestedTier: record.requestedTier, activeTier: record.activeTier, fallbackTrail: [...record.fallbackTrail], state: record.state, activeTools: [...record.activeTools], startedAt: record.startedAt, endedAt: record.endedAt, latestFinding: record.latestFinding, result: record.result, error: record.error, cancelReason: record.cancelReason, terminalReason: record.terminalReason };
  }
  private emit(event: ParentEvent): void { this.options.onParentEvent?.(event); }
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

async function createSessionWithTimeout(options: Parameters<typeof createWorkerSession>[0], configuredTimeoutMs?: number): Promise<any> {
  const timeoutMs = configuredTimeoutMs ?? DTEAM_CONFIG.dispatch.workerTimeoutMs;
  const creation = Promise.resolve(createWorkerSession(options));
  let settled = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  return new Promise<any>((resolve, reject) => {
    const finish = (callback: () => void) => { if (settled) return; settled = true; if (timer) clearTimeout(timer); callback(); };
    timer = setTimeout(() => finish(() => reject(new WorkerTimeoutError(`worker session 创建超时（${timeoutMs}ms）`))), timeoutMs);
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
  if (requestKind === "request_decision" || requestKind === "blocked") return responseType === "decision";
  return false;
}

function isTerminal(state: WorkerSnapshot["state"]): boolean {
  return ["completed", "failed", "timed_out", "cancelled", "shutdown"].includes(state);
}

function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error); }
