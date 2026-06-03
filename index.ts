/**
 * dteam v1 — Pi 扩展入口
 *
 * 暴露 1 个工具给主 LLM：
 *   - dteam(action="run", goal="...")  → 同步阻塞跑完一个 goal
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { run } from "./src/orchestrator.js";

export default function (pi: ExtensionAPI) {
  pi.registerTool({
    name: "dteam",
    label: "dteam",
    description:
      "Run a goal end-to-end through dteam's recursive worker tree. " +
      "The root worker decomposes the goal by asking an LLM at each level, " +
      "then dispatches leaf workers to do the work. " +
      "Synchronous: returns when everything is done or failed.",
    parameters: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["run"] },
        goal: { type: "string", description: "The goal to accomplish" },
      },
      required: ["action", "goal"],
    } as const,
    async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
      const { action, goal } = params as { action: string; goal: string };

      if (action !== "run") {
        return {
          content: [{ type: "text" as const, text: `dteam: unknown action "${action}"` }],
          isError: true,
          details: {},
        };
      }

      // 检查 ctx 上有 model + modelRegistry
      if (!ctx.model) {
        return {
          content: [{ type: "text" as const, text: "dteam: no session model available" }],
          isError: true,
          details: {},
        };
      }

      ctx.ui.notify(`dteam: running "${goal}"`, "info");
      ctx.ui.setStatus("dteam", `running: ${goal}`);

      try {
        const result = await run(goal, ctx);
        ctx.ui.setStatus("dteam", undefined);
        return {
          content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
          details: {},
        };
      } catch (e) {
        ctx.ui.setStatus("dteam", undefined);
        return {
          content: [{ type: "text" as const, text: `dteam failed: ${(e as Error).message}` }],
          isError: true,
          details: {},
        };
      }
    },
  });
}
