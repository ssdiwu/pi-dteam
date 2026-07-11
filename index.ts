/**
 * dteam 0.7 — Pi 扩展入口。
 *
 * 对外只注册 dteam_dispatch：主模型负责路由，dteam 执行一次 fresh worker 派发。
 * 执行、fresh 验收和回退由 tier / task / tools 的不同组合表达，不另建工具。
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { AdaptiveConcurrency, DEFAULT_CONCURRENCY_CONFIG } from "./src/dispatch/concurrency.js";
import { dispatch } from "./src/leaf.js";
import { tierModelRoutesFromEnv } from "./src/session/tier-config.js";
import { THINKING_LEVELS, TIERS, type ThinkingLevel, type Tier } from "./src/types/dispatch.js";

const RUNTIME_KEY = "__piDteamDispatchRuntime";

type DispatchRuntime = {
  concurrency: AdaptiveConcurrency;
};

type DteamGlobal = typeof globalThis & {
  [RUNTIME_KEY]?: DispatchRuntime;
};

function dispatchRuntime(): DispatchRuntime {
  const global = globalThis as DteamGlobal;
  if (!global[RUNTIME_KEY]) {
    global[RUNTIME_KEY] = {
      concurrency: new AdaptiveConcurrency(DEFAULT_CONCURRENCY_CONFIG),
    };
  }
  return global[RUNTIME_KEY]!;
}

function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

function isThinkingLevel(value: unknown): value is ThinkingLevel {
  return typeof value === "string" && (THINKING_LEVELS as readonly string[]).includes(value);
}

function toolError(message: string) {
  return {
    content: [{ type: "text" as const, text: `dteam_dispatch: ${message}` }],
    isError: true,
    details: {},
  };
}

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "dteam_dispatch",
    label: "dteam dispatch",
    description:
      "dteam 的模型分级派发工具。主模型负责判断任务难度和独立性：T1 用于思考、fresh 验收和回退重做；T2 用于常规实现；T3 用于可并行的机械小任务。" +
      "每次调用创建 fresh、逻辑隔离的进程内 worker。执行、fresh 验收和回退都调用本工具；不要调用不存在的 dteam_check/dteam_plan。" +
      "T3 默认只读；独立小改必须在 tools 显式授予 edit/write。关键任务的 fresh 验收应使用 tier=T1 和只读 tools。",
    parameters: {
      type: "object",
      properties: {
        task: {
          type: "string",
          description: "fresh worker 可独立完成的任务描述；必须带上验收所需上下文。",
        },
        tier: {
          type: "string",
          enum: [...TIERS],
          description: "T1=思考/验收/回退，T2=常规实现，T3=机械小任务。",
        },
        thinking: {
          type: "string",
          enum: [...THINKING_LEVELS],
          description: "可选覆盖档位默认思考强度：T1 高、T2 中、T3 低。",
        },
        tools: {
          type: "array",
          items: { type: "string" },
          description: "可选工具白名单；提供时是所有回退尝试的最高权限上限。",
        },
      },
      required: ["task", "tier"],
    } as const,
    async execute(_toolCallId, rawParams, signal, _onUpdate, ctx) {
      const params = rawParams as {
        task?: unknown;
        tier?: unknown;
        thinking?: unknown;
        tools?: unknown;
      };

      if (typeof params.task !== "string" || !params.task.trim()) {
        return toolError("task 必须是非空字符串");
      }
      if (!isTier(params.tier)) {
        return toolError("tier 必须是 T1、T2 或 T3");
      }
      if (params.thinking !== undefined && !isThinkingLevel(params.thinking)) {
        return toolError("thinking 必须是 low、medium 或 high");
      }
      if (params.tools !== undefined && (!Array.isArray(params.tools) || !params.tools.every((tool) => typeof tool === "string"))) {
        return toolError("tools 必须是字符串数组");
      }
      if (!ctx.model || !ctx.modelRegistry) {
        return toolError("当前会话没有可用模型或 modelRegistry");
      }

      ctx.ui?.setStatus?.("dteam", `dispatch ${params.tier}: ${params.task}`);
      try {
        const result = await dispatch(
          {
            task: params.task,
            tier: params.tier,
            ...(params.thinking ? { thinking: params.thinking } : {}),
            ...(params.tools ? { tools: params.tools } : {}),
          },
          {
            cwd: ctx.cwd || process.cwd(),
            modelRegistry: ctx.modelRegistry,
            model: ctx.model,
            tierModelRoutes: tierModelRoutesFromEnv(),
            signal,
            concurrency: dispatchRuntime().concurrency,
          },
        );

        const succeeded = result.status === "done";
        ctx.ui?.notify?.(
          `dteam_dispatch: ${succeeded ? "完成" : "失败"} — ${result.result || result.error || "无结果"}`,
          succeeded ? "info" : "error",
        );
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          isError: !succeeded,
          details: { result },
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        ctx.ui?.notify?.(`dteam_dispatch: 异常 — ${message}`, "error");
        return toolError(message);
      } finally {
        ctx.ui?.setStatus?.("dteam", undefined);
      }
    },
  });

}
