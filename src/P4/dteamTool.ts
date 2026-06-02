/**
 * P4-dteamTool：dteam 调度入口工具
 *
 * 4 个 action：list / plan / run / status
 * 让主 LLM 能根据用户描述自动选角色、组装 worker、决定执行模式。
 */

import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";
import { DTEAM_PACKAGE_ROOT, workerCreate, workerStart, workerStatus } from "../P2/worker.js";
import type { WorkerConfig } from "../P0/config.js";
import { planFromTaskId, type ChainPlan } from "../P3/chainPlanner.js";
// 静态 import：避免动态 import 丢事件
// 之前用 import("./worker-widget.js").then(...) 是异步，会导致 onProgress/onComplete 闭包
// 内的 mod 在事件触发时仍未 resolve，进度/终态事件丢失（AC7 FAIL）。
import { updateAgentProgress, registerWorkerTerminated } from "./worker-widget.js";

// ── 类型定义 ──────────────────────────────────────────────────

/** 从 agents/*.md 解析的角色元数据 */
export interface AgentMeta {
  name: string;
  description: string;
  tools: string[];
  defaultContext?: string;
  thinking?: string;
}

/** plan 输出的执行计划 */
export interface ExecutionPlan {
  mode: "solo" | "chain" | "team";
  agents: string[];
  steps: PlanStep[];
}

/** plan 中的单步 */
export interface PlanStep {
  agent: string;
  task: string;
  dependsOn?: string[];
}

/** dteam 工具入参 */
export interface DteamParams {
  action: "list" | "plan" | "run" | "status";
  /** plan/run 使用：用户目标描述 */
  goal?: string;
  /** plan/run 使用：指定角色列表（可选） */
  agents?: string[];
  /** plan/run 使用：执行模式（可选，默认自动推断） */
  mode?: "solo" | "chain" | "team";
  /** plan/run 使用：执行风格 */
  style?: string;
  /** run 使用：已有 plan（跳过推断直接执行） */
  plan?: ExecutionPlan;
  /** plan 使用：从 task 文件自动生成 chain plan */
  taskId?: string;
  /** status 使用：worker ID */
  workerId?: string;
}

// ── 角色默认链 ────────────────────────────────────────────────

/** 默认链式执行顺序 */
const DEFAULT_CHAIN: readonly string[] = ["explore", "design", "build", "check", "close"];

// ── list：从 agents/*.md 读 frontmatter ──────────────────────

/**
 * 扫描 agents/ 目录，解析所有 .md 文件的 frontmatter，返回角色列表。
 */
export async function listAgents(): Promise<AgentMeta[]> {
  const agentsDir = join(DTEAM_PACKAGE_ROOT, "agents");
  const files = await readdir(agentsDir);
  const mdFiles = files.filter((f) => f.endsWith(".md"));

  const results: AgentMeta[] = [];
  for (const file of mdFiles) {
    try {
      const content = await readFile(join(agentsDir, file), "utf-8");
      const { frontmatter } = parseFrontmatter<Record<string, string>>(content);
      const name = frontmatter.name ?? file.replace(/\.md$/, "");
      const description = frontmatter.description ?? "";
      const tools = frontmatter.tools
        ?.split(",")
        .map((t) => t.trim())
        .filter(Boolean) ?? [];
      results.push({
        name,
        description,
        tools,
        defaultContext: frontmatter.defaultContext,
        thinking: frontmatter.thinking,
      });
    } catch {
      // 跳过解析失败的文件
    }
  }

  return results;
}

// ── plan：推断执行计划 ────────────────────────────────────────

/**
 * 根据 goal + agents 推断执行计划。
 *
 * - 1 个 agent → solo
 * - 多 agent + 显式 mode=team → team（并行）
 * - 多 agent → chain（串行，按 DEFAULT_CHAIN 排序）
 */
export function buildPlan(params: {
  goal: string;
  agents?: string[];
  mode?: "solo" | "chain" | "team";
}): ExecutionPlan {
  const { goal, agents, mode } = params;

  // 如果没有指定 agents，默认使用全链
  const selectedAgents = agents && agents.length > 0
    ? agents
    : [...DEFAULT_CHAIN];

  // 过滤掉不在 DEFAULT_CHAIN 中的非法角色（宽松校验）
  const validAgents = selectedAgents.filter((a) =>
    DEFAULT_CHAIN.includes(a),
  );

  // 如果过滤后为空，fallback 到 build
  const finalAgents = validAgents.length > 0 ? validAgents : ["build"];

  // 推断 mode
  let resolvedMode: "solo" | "chain" | "team";
  if (mode) {
    resolvedMode = mode;
  } else if (finalAgents.length === 1) {
    resolvedMode = "solo";
  } else {
    resolvedMode = "chain";
  }

  // 生成 steps
  const steps: PlanStep[] = finalAgents.map((agent, i) => ({
    agent,
    task: `[${agent}] ${goal}`,
    ...(i > 0 ? { dependsOn: [finalAgents[i - 1]] } : {}),
  }));

  return { mode: resolvedMode, agents: finalAgents, steps };
}

// ── run：创建 + 启动 worker ──────────────────────────────────

/**
 * 根据执行计划构建 WorkerConfig 并创建 worker。
 * 返回 workerId，由调用方决定是否启动。
 */
export function planToWorkerConfig(plan: ExecutionPlan, goal: string, style: string): WorkerConfig {
  const { mode, agents } = plan;

  if (mode === "solo") {
    return {
      type: "solo",
      task: goal,
      style,
      options: [{ type: "role", value: agents[0] }],
    };
  }

  if (mode === "team") {
    return {
      type: "team",
      task: goal,
      style,
      options: [
        {
          type: "workers",
          value: agents.map((agent) => ({
            type: "solo",
            task: `[${agent}] ${goal}`,
            style,
            options: [{ type: "role", value: agent }],
          })),
        },
      ],
    };
  }

  // chain 模式
  return {
    type: "chain",
    task: goal,
    style,
    options: [
      {
        type: "steps",
        value: agents.map((agent) => ({
          type: "solo",
          task: `[${agent}] ${goal}`,
          style,
          options: [{ type: "role", value: agent }],
        })),
      },
    ],
  };
}

/**
 * 执行 dteam run：创建 worker 并后台启动。
 * 返回 { workerId, plan, message }。
 */
export async function executeRun(
  ctx: { cwd: string },
  params: DteamParams,
): Promise<{ content: string }> {
  const goal = params.goal;
  if (!goal) {
    return { content: JSON.stringify({ error: "run 需要 goal 参数" }) };
  }

  const style = params.style ?? "pragmatist";

  // 确定 plan：优先用传入的 plan，否则从 goal + agents 推断
  const plan = params.plan ?? buildPlan({
    goal,
    agents: params.agents,
    mode: params.mode,
  });

  // 构建 WorkerConfig
  const config = planToWorkerConfig(plan, goal, style);

  // 调 workerCreate
  const createResult = await workerCreate(ctx, { config });
  const createData = JSON.parse(createResult.content);
  if (createData.error) {
    return { content: JSON.stringify({ error: createData.error }) };
  }

  const workerId = createData.workerId;

  // 调 workerStart（background 模式）— 自动透传 onProgress + onComplete（闭包绑定 workerId）
  // 这样 P4 store 能收到该 worker 的实时进度 + 终态清理
  const startResult = await workerStart(ctx, {
    workerId,
    background: true,
    onProgress: (p) => {
      // 静态 import：updateAgentProgress 在 import 顶部已解析，事件不丢
      updateAgentProgress(workerId, p);
    },
    onComplete: (status, error) => {
      // 静态 import：registerWorkerTerminated 在 import 顶部已解析，事件不丢
      registerWorkerTerminated(workerId, status, error);
    },
  });
  const startData = JSON.parse(startResult.content);

  if (startData.error) {
    return {
      content: JSON.stringify({ error: startData.error, workerId }),
    };
  }

  return {
    content: JSON.stringify({
      workerId,
      plan,
      background: true,
      message: `Worker ${workerId} 已启动（${plan.mode} 模式，${plan.agents.length} 个角色）`,
    }),
  };
}

// ── status：查询 worker 状态 ─────────────────────────────────

/**
 * 包装 worker_status，提供 dteam 视角的状态输出。
 */
export async function executeStatus(
  ctx: { cwd: string },
  params: DteamParams,
): Promise<{ content: string }> {
  const { workerId } = params;
  if (!workerId) {
    return { content: JSON.stringify({ error: "status 需要 workerId 参数" }) };
  }

  const result = await workerStatus(ctx, { workerId });
  return result;
}

// ── 统一入口：handleDteamAction ───────────────────────────────

/**
 * dteam 工具的统一 action 分发器。
 */
export async function handleDteamAction(
  ctx: { cwd: string },
  params: DteamParams,
): Promise<{ content: string }> {
  switch (params.action) {
    case "list": {
      const agents = await listAgents();
      return {
        content: JSON.stringify({
          agents,
          count: agents.length,
          message: `发现 ${agents.length} 个角色`,
        }),
      };
    }

    case "plan": {
      // 优先从 taskId 自动生成 chain plan
      if (params.taskId) {
        try {
          const chainPlan = await planFromTaskId(ctx.cwd, params.taskId);
          return {
            content: JSON.stringify({
              chainPlan,
              message: `Chain plan 已生成：${chainPlan.taskType} 类型，${chainPlan.steps.length} 个步骤`,
            }),
          };
        } catch (err) {
          return { content: JSON.stringify({ error: (err as Error).message }) };
        }
      }

      if (!params.goal) {
        return { content: JSON.stringify({ error: "plan 需要 goal 或 taskId 参数" }) };
      }
      const plan = buildPlan({
        goal: params.goal,
        agents: params.agents,
        mode: params.mode,
      });
      return {
        content: JSON.stringify({
          plan,
          message: `执行计划：${plan.mode} 模式，${plan.agents.length} 个角色`,
        }),
      };
    }

    case "run": {
      return executeRun(ctx, params);
    }

    case "status": {
      return executeStatus(ctx, params);
    }

    default:
      return {
        content: JSON.stringify({
          error: `未知 action: ${params.action}`,
          validActions: ["list", "plan", "run", "status"],
        }),
      };
  }
}
