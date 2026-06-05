/**
 * dteam v1 — worker_sendSignal 工具工厂
 *
 * 给 createAgentSession 注入的 customTool：worker 向主编排器发信号。
 * 闭包捕获 dteamContext（signalBus + runsStore + runId + workerId）。
 */

import type { DteamContext } from "../types/context.js";
import type { SignalType } from "../types/signal.js";

/** 创建 worker_sendSignal customTool（闭包捕获 dteamContext） */
export function makeWorkerSendSignalTool(dteamCtx: DteamContext) {
  return {
    name: "worker_sendSignal",
    label: "worker_sendSignal",
    description:
      "向主编排器上报信号。4 种类型：progress（进度）、found（发现）、blocked（阻塞）、help（求助）。",
    parameters: {
      type: "object" as const,
      properties: {
        signalType: {
          type: "string" as const,
          enum: ["progress", "found", "blocked", "help"],
          description: "信号类型",
        },
        data: {
          type: "object" as const,
          description: "信号 payload（根据 signalType 填写对应字段）",
        },
      },
      required: ["signalType", "data"],
    },
    async execute(
      _toolCallId: string,
      params: { signalType: string; data: any },
      _signal: any,
      _onUpdate: any,
      _ctx: any,
    ) {
      const { signalType, data } = params;
      const signal = {
        id: `s-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        type: signalType as SignalType,
        workerId: dteamCtx.workerId,
        runId: dteamCtx.runId,
        timestamp: Date.now(),
        data,
      };
      dteamCtx.signalBus.emit(signal);
      try {
        dteamCtx.runsStore.appendSignal(dteamCtx.runId, dteamCtx.workerId, signal);
      } catch {
        // worker 不在 runs 中，忽略
      }
      return {
        content: [{ type: "text" as const, text: `信号已记录: ${signal.id} (${signalType})` }],
      };
    },
  };
}
