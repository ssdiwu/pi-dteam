/**
 * Orchestrator 决策 customTool（替代 JSON 文本决策）
 *
 * 决策依据：ADR 0005 第 17 条（LLM-Driven Orchestration）。
 * 用 Pi tool calling 取代"LLM 返回 JSON 文本 + 正则解析"——
 * 消灭探测报告 P0-1（JSON 截断致 goal fail）和 P1-2（task 无长度约束）。
 *
 * 设计：参考 src/session/signal-tool.ts 的 makeWorkerSendSignalTool 闭包模式。
 * Orchestrator session 注入此 tool；LLM 调用它即结构化输出决策；
 * execute 闭包把决策写入 receiver，runLoop 从 receiver 取决策，
 * 不再从 session.messages 解析自由文本。
 */

import type {
  OrchestratorDecision,
  OrchestratorSummonDecision,
  OrchestratorCheckDecision,
  OrchestratorDoneDecision,
  OrchestratorFailDecision,
} from "../types/loop.js";

const VALID_ROLES = ["explore", "design", "build", "check", "close"] as const;

/** task 字段最大长度（P1-2：约束 Orchestrator task 简短，间接防截断） */
export const MAX_TASK_LENGTH = 200;

/**
 * 决策接收器：runLoop 创建后传入 tool，execute 写入，runLoop 读取。
 * 一轮决策只用一次（每次 decide 前新建）。
 */
export interface DecisionReceiver {
  decision: OrchestratorDecision | null;
}

export function createDecisionReceiver(): DecisionReceiver {
  return { decision: null };
}

/**
 * 创建 orchestrator_decide customTool。
 * 闭包捕获 receiver，LLM 调用时把结构化决策写入 receiver.decision。
 */
export function makeOrchestratorDecideTool(receiver: DecisionReceiver) {
  return {
    name: "orchestrator_decide",
    label: "orchestrator_decide",
    description:
      "上报本轮编排决策。每轮必须调用且只调用一次。根据 type 填对应字段。" +
      "task 要简短具体（≤200 字符），细节交给 worker 自己探索，不要在 task 里写完整执行步骤。",
    promptGuidelines: [
      "你每一轮必须调用一次 orchestrator_decide 工具来上报决策，不要返回纯文本或 JSON。",
      "只读/信息类目标（说明、解释、调研、定位）不要召唤 build——build 只在目标明确要求改文件时用。",
      "同类角色连续 2 次失败/被中断后，必须换策略（换角色、缩小 task、或直接 check/fail），不要盲目重试。",
    ],
    parameters: {
      type: "object" as const,
      properties: {
        type: {
          type: "string" as const,
          enum: ["summon", "check", "done", "fail"],
          description: "决策类型：summon=召唤角色干活；check=召唤 check 收口（主体完成后）；done=完成（仅 check 通过后）；fail=无法继续",
        },
        role: {
          type: "string" as const,
          enum: [...VALID_ROLES],
          description: "仅 type=summon/check 时填。summon 时是任意五角色；check 时填 check",
        },
        task: {
          type: "string" as const,
          maxLength: MAX_TASK_LENGTH,
          description: "给 worker 的任务说明（≤200 字符，简短具体，细节让 worker 自己探索）",
        },
        reason: {
          type: "string" as const,
          maxLength: 300,
          description: "决策理由（为什么这一步这么做）",
        },
        parallel: {
          type: "number" as const,
          minimum: 1,
          maximum: 5,
          description: "可选，仅 type=summon。并发召唤同类 worker 数量，缺省 1。任务可拆分时填 2-3",
        },
      },
      required: ["type", "reason"],
    },
    async execute(
      _toolCallId: string,
      params: {
        type: string;
        role?: string;
        task?: string;
        reason?: string;
        parallel?: number;
      },
    ) {
      const decision = normalizeDecision(params);
      receiver.decision = decision;

      const ack =
        decision.type === "summon"
          ? `已记录决策：召唤 ${decision.role}（task: ${decision.task.slice(0, 60)}${decision.task.length > 60 ? "…" : ""}）`
          : decision.type === "check"
            ? `已记录决策：召唤 check 收口`
            : decision.type === "done"
              ? `已记录决策：完成（仅 check 通过后有效）`
              : `已记录决策：失败（${decision.reason}）`;

      return {
        content: [{ type: "text" as const, text: ack }],
      };
    },
  };
}

/** 把 tool 参数规范化为 OrchestratorDecision（含校验与兜底） */
function normalizeDecision(params: {
  type: string;
  role?: string;
  task?: string;
  reason?: string;
  parallel?: number;
}): OrchestratorDecision {
  const type = String(params.type ?? "").toLowerCase().trim();
  const reason = String(params.reason ?? "").trim();

  if (type === "summon") {
    const role = normalizeRole(params.role);
    const task = clampTask(params.task);
    const parallelRaw = Number(params.parallel);
    const parallel = Number.isFinite(parallelRaw) && parallelRaw >= 2 ? Math.min(Math.floor(parallelRaw), 5) : undefined;
    const d: OrchestratorSummonDecision = {
      type: "summon",
      role,
      task,
      reason,
      ...(parallel ? { parallel } : {}),
    };
    return d;
  }

  if (type === "check") {
    const d: OrchestratorCheckDecision = {
      type: "check",
      task: clampTask(params.task) || "验证目标是否达成",
      reason,
    };
    return d;
  }

  if (type === "done") {
    const d: OrchestratorDoneDecision = { type: "done", reason };
    return d;
  }

  const d: OrchestratorFailDecision = {
    type: "fail",
    reason: reason || `未知决策类型: ${type}`,
  };
  return d;
}

function normalizeRole(raw: unknown): OrchestratorSummonDecision["role"] {
  const lower = String(raw ?? "").toLowerCase().trim();
  const found = VALID_ROLES.find(r => lower.includes(r));
  return found ?? "build";
}

/** task 截断到 MAX_TASK_LENGTH；空则给占位 */
function clampTask(raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (!t) return "（Orchestrator 未给出任务说明）";
  return t.length > MAX_TASK_LENGTH ? `${t.slice(0, MAX_TASK_LENGTH - 1)}…` : t;
}
