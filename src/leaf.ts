/**
 * dteam v1 — 叶子执行器 (leaf) [thin coordinator]
 *
 * 唯一职责：用指定角色调 LLM 执行一个 step。
 * 角色决定 systemPrompt + tools（由 session.ts 的角色系统处理）。
 *
 * 拆出去的子文件：
 *  - src/leaf/worker-id.ts : nextWorkerId
 *  - src/leaf/extract.ts   : extractFinalText
 *  - src/leaf/supplement.ts : waitForSupplement
 */

import { createWorkerSession, pickAvailableModel } from "./session.js";
import { uiStore } from "./ui/index.js";
import { DTEAM_CONFIG } from "./config.js";
import type { RoleName } from "./types/role.js";
import type { DteamContext } from "./types/context.js";
import { nextWorkerId } from "./leaf/worker-id.js";
import { extractLastText } from "./leaf/extract.js";
import { waitForSupplement } from "./leaf/supplement.js";

/**
 * 用指定角色执行一个任务。
 * 支持信号自愈：叶子发 help → 等待根注入补充信息 → 继续执行。
 *
 * @param tools 可选：显式指定此 worker 的工具子集（0.4.1 已落地，方案 D）。
 *              undefined → 走 ROLE_DEFAULTS[role].tools（0.4.0 兼容行为）。
 *              设计：见 doc/40-版本实施方案/41-工具动态加载方案.md
 */
export async function execute(
  role: RoleName,
  task: string,
  ctx: LeafContext,
  goal: string,
  tools?: string[],
): Promise<string> {
  const dteam = ctx.dteam;
  const workerId = dteam?.currentStepId ?? nextWorkerId(role);
  const input = `[全局目标: ${goal}]\n\n${task}`;

  // 注册 worker 到 runs
  if (dteam) {
    dteam.runsStore.addWorker(dteam.runId, {
      id: workerId, role, task, input,
      signals: [], startedAt: Date.now(), status: "running",
    });
  }

  // 构建 worker 级 dteamContext（覆盖 workerId）
  const workerDteamCtx: DteamContext | undefined = dteam
    ? { signalBus: dteam.signalBus, runsStore: dteam.runsStore, runId: dteam.runId, workerId, pendingSupplements: dteam.pendingSupplements, injectionQueue: dteam.injectionQueue }
    : undefined;

  const session = await createWorkerSession({
    role,
    cwd: ctx.cwd || process.cwd(),
    modelStr: pickAvailableModel(ctx),
    ctx,
    dteamContext: workerDteamCtx,
    builtInTools: tools,
  });

  let currentTask = input;
  let output = "(no output)";

  for (let round = 0; round < DTEAM_CONFIG.leaf.maxHelpRounds; round++) {
    const roundStart = Date.now();
    await session.prompt(currentTask);

    output = extractLastText(session.messages as any[]);

    if (!dteam) break;

    // 检查本轮新发的 help 信号 或 根转发的内容
    const helpSignals = dteam.signalBus.getHistory(workerId)
      .filter(s => s.type === "help" && s.timestamp >= roundStart);
    const injectionQueue = dteam.injectionQueue.get(workerId) ?? [];
    const hasInjection = injectionQueue.length > 0;

    if (helpSignals.length === 0 && !hasInjection) break;

    // 等待根注入补充信息（可能来自 help 自愈 或 root 转发）
    const supplement = await waitForSupplement(dteam, workerId, DTEAM_CONFIG.leaf.supplementTimeoutMs);
    if (!supplement) break;

    const source = hasInjection ? "根转发（来自其他叶子的发现/进度）" : "help 信号响应";
    currentTask = `## 补充信息（${source}）\n${supplement}\n\n请继续完成原任务。不要重复已完成的工作，直接从补充信息出发继续。`;
  }

  // 标记 worker 完成
  if (dteam) {
    dteam.runsStore.finishWorker(dteam.runId, workerId, output,
      output === "(no output)" ? "failed" : "done");
  }

  return output;
}

/**
 * 叶子执行器的最小 ctx 接口（修 L-1：去掉 ctx: any）。
 * 完整 PiExtensionContext 有更多字段，这里只声明 leaf 用到的。
 */
export interface LeafContext {
  cwd: string;
  dteam?: DteamContext;
  modelRegistry: any;
  model?: { provider: string; id: string };
  [k: string]: any; // 兼容其他字段（session 创建时透传）
}
