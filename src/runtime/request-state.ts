import type { ParentResponse, RecoveryAction } from "./types.js";

type RequestResponse = ParentResponse | RecoveryAction;
export type PendingRequestKind = "request_context" | "request_tools" | "request_tool_budget" | "request_decision" | "blocked" | "timeout_recovery";

export interface PendingRequest {
  workerId: string;
  requestId: string;
  kind: PendingRequestKind;
  payload: unknown;
  resolve: (response: RequestResponse) => void;
  reject: (error: Error) => void;
}

export class RequestState {
  private readonly pending = new Map<string, PendingRequest>();

  wait(request: Omit<PendingRequest, "resolve" | "reject">): Promise<RequestResponse> {
    const key = requestKey(request.workerId, request.requestId);
    if (this.pending.has(key)) throw new Error(`dteam: requestId 已存在于该 worker ${request.requestId}`);
    return new Promise<RequestResponse>((resolve, reject) => this.pending.set(key, { ...request, resolve, reject }));
  }
  get(workerId: string, requestId: string): PendingRequest | undefined { return this.pending.get(requestKey(workerId, requestId)); }
  respond(workerId: string, requestId: string, response: RequestResponse): void {
    const key = requestKey(workerId, requestId);
    const request = this.pending.get(key);
    if (!request) throw new Error("dteam: request 不存在或不属于该 worker");
    this.pending.delete(key);
    request.resolve(response);
  }
  cancelWorker(workerId: string, reason: string): void {
    for (const [key, request] of this.pending) {
      if (request.workerId !== workerId) continue;
      this.pending.delete(key);
      request.resolve({ type: "deny", reason });
    }
  }
  clear(): void {
    for (const request of this.pending.values()) request.reject(new Error("dteam: session 已关闭"));
    this.pending.clear();
  }
  list(): PendingRequest[] { return [...this.pending.values()]; }
}

function requestKey(workerId: string, requestId: string): string { return `${workerId}:${requestId}`; }
