/**
 * dteam v1 — 叶子执行器 (leaf)
 *
 * 唯一职责：用指定角色调 LLM 执行一个 step。
 * 角色决定 systemPrompt + tools（由 session.ts 的角色系统处理）。
 */

import { createWorkerSession, pickAvailableModel } from "./session.js";
import { uiStore } from "./ui/index.js";
import type { RoleName, DteamContext } from "./tools.js";

const MAX_HELP_ROUNDS = 3;
const SUPPLEMENT_TIMEOUT_MS = 60_000;

/**
 * 用指定角色执行一个任务。
 * 支持信号自愈：叶子发 help → 等待根注入补充信息 → 继续执行。
 */
export async function execute(
  role: RoleName,
  task: string,
  ctx: any,
  goal: string,
): Promise<string> {
  const dteam = ctx.dteam as DteamContext | undefined;
  const workerId = dteam?.currentStepId ?? `w-${role}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
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
  });

  let currentTask = input;
  let output = "(no output)";

  for (let round = 0; round < MAX_HELP_ROUNDS; round++) {
    const roundStart = Date.now();
    await session.prompt(currentTask);

    // 从 session.messages 取最终文本
    output = extractLastText(session.messages as any[]);

    if (!dteam) break;

    // 检查本轮新发的 help 信号 或 根转发的内容
    const helpSignals = dteam.signalBus.getHistory(workerId)
      .filter(s => s.type === "help" && s.timestamp >= roundStart);
    const injectionQueue = dteam.injectionQueue.get(workerId) ?? [];
    const hasInjection = injectionQueue.length > 0;

    if (helpSignals.length === 0 && !hasInjection) break;

    // 等待根注入补充信息（可能来自 help 自愈 或 root 转发）
    const supplement = await waitForSupplement(dteam, workerId);
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

/** 从 messages 提取最后一条 assistant 文本 */
function extractLastText(messages: any[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    if (msg.role !== "assistant") continue;
    const content: any[] = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part.type === "text") return part.text;
    }
  }
  return "(no output)";
}

/**
 * 轮询等待根注入（队列或 help 响应） 。
 * 【可观察】反在队列中有内容时，同步返出；空时返回 null（避免 Promise 阻塞）。
 */
function waitForSupplement(
  dteam: DteamContext,
  workerId: string,
): Promise<string | null> {
  // 优先消费 injectionQueue
  const queue = dteam.injectionQueue.get(workerId);
  if (queue && queue.length > 0) {
    return Promise.resolve(queue.shift() ?? null);
  }

  // 队列为空 → 调 Promise 等待 help 自愈路径
  return new Promise((resolve) => {
    dteam.pendingSupplements.set(workerId, resolve);
    setTimeout(() => {
      if (dteam.pendingSupplements.has(workerId)) {
        dteam.pendingSupplements.delete(workerId);
        resolve(null);
      }
    }, SUPPLEMENT_TIMEOUT_MS);
  });
}

// ═══ 模型解析已抽取到 session.ts（pickAvailableModel） ═══
