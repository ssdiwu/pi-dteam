/**
 * worker 工具实现（增强版）
 *
 * 3个工具：worker_create/start/sendSignal
 * 
 * 增强功能：
 * 1. 使用增强的共享内存
 * 2. 使用上下文构建器
 * 3. 支持真实的执行器
 */

import { WorkerConfig, normalizeOptions } from "../P0/config.js";
import { SignalType } from "../P0/signal.js";
import { SignalBus } from "../P1/signalBus.js";
import { EnhancedSharedMemory, createEnhancedSharedMemory } from "../P1/enhancedSharedMemory.js";
import { ContextBuilder, createContextBuilder, ExecutionContext, Executor } from "../P2/contextBuilder.js";
import { runWorker } from "../P3/worker.js";
import { resolveDteamMemoryPath } from "../P0/pathSafety.js";
import { spawnAgent, type SpawnResult } from "../P1/spawn.js";
import { createWorktree, cleanupWorktree, isGitRepo } from "../P1/worktree.js";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readFile } from "node:fs/promises";
import { parseFrontmatter } from "@earendil-works/pi-coding-agent";

// ── dteam package 根路径(用于加载 agents/*.md)─────────────────
// worker.ts 编译后位于 dist/P2/worker.js，源码位于 src/P2/worker.ts。
// 两者都从 dist/src 同名目录出发，../.. 都指向 package 根。
const __worker_filename = fileURLToPath(import.meta.url);
const __worker_dirname = dirname(__worker_filename);
export const DTEAM_PACKAGE_ROOT = join(__worker_dirname, "../..");

/**
 * 读当前 sessionModel（由 P4 入口的 model_select 事件更新）。
 * 任何时候被 P4 调 setSessionModel() 都会更新。
 */
export function getSessionModel(): string | undefined {
  return _sessionModelHolder.current;
}

/**
 * P4 入口在 model_select 事件中调用。
 */
export function setSessionModel(model: string | undefined): void {
  _sessionModelHolder.current = model;
}

/**
 * 读 context 对应的 WorkerConfig（P2/worker.ts 的 wrappedExecutor set）。
 * 用于 P4 注册的“llm” executor 复用。
 */
export function getConfigForContext(
  context: ExecutionContext,
): WorkerConfig | undefined {
  return _configByContext.get(context);
}

/**
 * 加载 dteam 内置 agents/<role>.md，解析 frontmatter 拿 systemPrompt + tools + model。
 * 文件不存在时返回 null，调用方需降级。
 */
export async function loadAgentRole(
  role: string,
): Promise<{ systemPrompt: string; tools?: string[]; model?: string; fallbackModels?: string[] } | null> {
  const filePath = join(DTEAM_PACKAGE_ROOT, "agents", `${role}.md`);
  try {
    const content = await readFile(filePath, "utf-8");
    const { frontmatter, body } = parseFrontmatter<Record<string, string>>(content);
    const tools = frontmatter.tools
      ?.split(",")
      .map((t) => t.trim())
      .filter(Boolean);
    // fallbackModels 在 frontmatter 中可能是多行 YAML 数组或逗号分隔字符串
    let fallbackModels: string[] | undefined;
    const fbRaw = frontmatter.fallbackModels;
    if (fbRaw) {
      // YAML 数组：'  - "a/1"\n  - "b/2"' → 简单 split
      fallbackModels = fbRaw
        .split(/[\n,]/)
        .map((s) => s.trim().replace(/^["']|["']$/g, ""))
        .filter((s) => s.length > 0 && !s.startsWith("/"));
    }
    return {
      systemPrompt: body || content,
      tools: tools && tools.length > 0 ? tools : undefined,
      model: frontmatter.model || undefined,
      fallbackModels,
    };
  } catch {
    return null;
  }
}

// ── 全局状态 ──────────────────────────────────────────────────

/**
 * 临时映射：worker 执行时，在 wrappedExecutor 里把 WorkerConfig 存到这里，
 * 供默认 executor 闭包读取。WeakMap 让 ExecutionContext GC 后自动清理。
 */
const _configByContext = new WeakMap<ExecutionContext, WorkerConfig>();
/**
 * sessionModel 闭包（P4 入口在 model_select 事件中更新）。
 * 实际不从 _sessionModelByContext 读——由 P4 入口注册“llm” executor 时闭包持证。
 * 这里预留为占位。
 */
const _sessionModelHolder: { current: string | undefined } = { current: undefined };

const workers = new Map<string, {
  config: WorkerConfig;
  bus: SignalBus;
  memory: EnhancedSharedMemory;
  contextBuilder: ContextBuilder;
  status: string;
  context?: ExecutionContext;
  background?: boolean;
  abortController?: AbortController;
}>();

export const bus = new SignalBus();
export const memory = createEnhancedSharedMemory();

// ── 执行器注册 ────────────────────────────────────────────────

/**
 * 执行器注册表
 * 
 * 可以注册自定义执行器，用于替代默认的模拟执行器
 */
const executorRegistry = new Map<string, (context: ExecutionContext) => Promise<string>>();

/**
 * 注册执行器
 */
export function registerExecutor(
  name: string,
  executor: (context: ExecutionContext) => Promise<string>,
): void {
  executorRegistry.set(name, executor);
}

/**
 * 获取执行器
 *
 * 两层查找：
 * 1. name 指定且已注册 → 用注册的（步骤 3 由 P4 入口注入"llm"）
 * 2. 其他（undefined / 未注册名称） → 走真路径（调 spawnAgent）
 */
function getExecutor(name?: string): (context: ExecutionContext) => Promise<string> {
  if (name && executorRegistry.has(name)) {
    return executorRegistry.get(name)!;
  }

  // 名称为"llm"或未提供名称 → 走真路径（调 spawnAgent）
  return async (context: ExecutionContext): Promise<string> => {
    const { role, task, cwd, taskContext, projectContext, executionHistory } = context;
    const config = _configByContext.get(context);

    // 加载 role 对应的 agents/<role>.md
    const roleData = await loadAgentRole(role);
    let systemPrompt: string;
    let tools: string[] | undefined;
    let modelFromRole: string | undefined;
    let fallbackModelsFromRole: string[] | undefined;
    if (roleData) {
      systemPrompt = roleData.systemPrompt;
      tools = roleData.tools;
      modelFromRole = roleData.model;
      fallbackModelsFromRole = roleData.fallbackModels;
    } else {
      // 降级：用 contextBuilder 构建的 prompt
      systemPrompt = buildExecutionPrompt(context);
    }

    // 拼装最终 task（带历史 + 阶段记录作为 context 注入）
    const stageRecord = taskContext.sections?.["阶段记录"] || "";
    const hasStageContent = stageRecord && !stageRecord.includes("（待填写）");
    let finalTask = task;
    if (hasStageContent) {
      finalTask = `${task}\n\n## 任务背景\n${stageRecord}`;
    }
    if (executionHistory?.previousResults?.length) {
      finalTask += `\n\n## 历史执行结果\n${executionHistory.previousResults
        .slice(-3)
        .map((r: { role: string; task: string; success: boolean; duration: number }) =>
          `- [${r.role}] ${r.task}: ${r.success ? "成功" : "失败"} (${r.duration}ms)`,
        )
        .join("\n")}`;
    }

    // 拿 sessionModel（由 P4 入口的 model_select 事件更新 _sessionModelHolder）
    const sessionModel = _sessionModelHolder.current;

    // 优先级：config.model (WorkerConfig 用户显式) > role model (frontmatter 默认) > sessionModel (兜底)
    const finalModel = config?.model ?? modelFromRole;
    const finalFallbacks = config?.fallbackModels ?? fallbackModelsFromRole;

    // 调 spawnAgent（接入 onProgress 回调以支持 TUI 实时进度）
    const result: SpawnResult = await spawnAgent({
      systemPrompt,
      task: finalTask,
      model: finalModel,
      fallbackModels: finalFallbacks,
      sessionModel,
      tools,
      cwd,
      onUpdate: context.onProgress
        ? (partial) => { if (partial.progress) context.onProgress!(partial.progress); }
        : undefined,
      onToolEvent: context.onProgress
        ? (event) => { if (event.progress) context.onProgress!(event.progress); }
        : undefined,
    });

    if (result.exitCode !== 0 || result.errorMessage) {
      const prefix = result.isModelError ? "[MODEL_ERROR]" : "[ERROR]";
      const errText = result.errorMessage || "spawn failed";
      context.bus.emit("blocked", context.role, {
        status: result.isModelError ? "model_error" : "spawn_error",
        error: errText,
        model: result.model,
        isModelError: result.isModelError ?? false,
      });
      return `${prefix} ${errText}\n\n[Partial output]:\n${result.output || "(empty)"}`;
    }
    return result.output || "(empty)";
  };
}

/**
 * 构建执行提示
 */
function buildExecutionPrompt(context: ExecutionContext): string {
  const { role, task, style, taskContext, projectContext, executionHistory } = context;
  
  let prompt = `你是一个 ${role} 角色，需要执行以下任务：

任务：${task}

任务详情：
- 目标：${taskContext.goal}
- 类型：${taskContext.type}
- 范围：${taskContext.scope.include.join(', ') || '未指定'}
- 验收条件：${taskContext.acceptance.join(', ') || '未指定'}

项目信息：
- 根目录：${projectContext.root}
- 依赖：${projectContext.dependencies.slice(0, 10).join(', ') || '无'}

相关文件：
${projectContext.relatedFiles.map(f => `- ${f.path} (${f.reason})`).join('\n') || '无'}

执行风格：${style}
`;

  // 添加阶段记录（探索发现、讨论决策、执行记录等）
  const stageRecord = taskContext.sections['阶段记录'] || '';
  const hasStageContent = stageRecord && !stageRecord.includes('（待填写）');
  if (hasStageContent) {
    prompt += `
阶段记录：
${stageRecord}`;
  }
  
  // 添加历史上下文
  if (executionHistory.previousResults.length > 0) {
    prompt += `\n历史执行结果：
${executionHistory.previousResults.slice(-3).map(r => 
  `- [${r.role}] ${r.task}: ${r.success ? '成功' : '失败'} (${r.duration}ms)`
).join('\n')}`;
  }
  
  if (executionHistory.decisions.length > 0) {
    prompt += `\n历史决策：
${executionHistory.decisions.slice(-3).map(d => 
  `- ${d.context}: 选择 ${d.chosen}，原因：${d.reason}`
).join('\n')}`;
  }
  
  if (executionHistory.learnings.length > 0) {
    prompt += `\n经验教训：
${executionHistory.learnings.slice(-5).map(l => `- ${l}`).join('\n')}`;
  }
  
  return prompt;
}

// ── 工具实现 ──────────────────────────────────────────────────

/**
 * worker_create — 创建 worker 实例
 */
export async function workerCreate(
  ctx: { cwd: string },
  params: { config: WorkerConfig },
): Promise<{ content: string }> {
  const { config } = params;

  // 防御性修复：Pi 工具的 JSON 序列化层可能把 options 数组错误转成对象。
  config.options = normalizeOptions(config.options);

  const workerId = `worker-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  // 创建上下文构建器
  const contextBuilder = createContextBuilder(ctx.cwd, memory, bus);

  workers.set(workerId, {
    config,
    bus,
    memory,
    contextBuilder,
    status: "pending",
  });

  return {
    content: JSON.stringify({
      workerId,
      config,
      message: `Worker created: ${workerId}`,
    }),
  };
}

/**
 * worker.start — 启动 worker 执行
 *
 * 参数：
 *   - workerId: 必传
 *   - executorName: 可选
 *   - background: 可选（后台模式不 await）
 *   - onProgress: 闭包绑定 workerId 的进度回调（P4 注入）
 *   - onComplete: 终态回调（done / failed）—— 关键修复：P4 通过这个收尾 store
 */
export async function workerStart(
  ctx: { cwd: string },
  params: {
    workerId: string;
    executorName?: string;
    background?: boolean;
    onProgress?: (progress: import("../P1/spawn.js").AgentProgress) => void;
    onComplete?: (status: "done" | "failed", error?: string) => void;
  },
): Promise<{ content: string }> {
  const { workerId, executorName, background = false, onProgress, onComplete } = params;
  const worker = workers.get(workerId);

  if (!worker) {
    return {
      content: JSON.stringify({
        error: `Worker not found: ${workerId}`,
      }),
    };
  }

  // 设置后台执行标志
  worker.background = background;
  worker.abortController = new AbortController();

  // worktree 隔离支持
  let worktreePath: string | undefined;
  const useWorktree = worker.config.worktree === true && isGitRepo(ctx.cwd);
  
  if (useWorktree) {
    try {
      const worktree = createWorktree({ workerId, cwd: ctx.cwd, autoCleanup: worker.config.worktreeAutoCleanup });
      worktreePath = worktree.path;
      console.log(`[dteam.worker] Using worktree: ${worktreePath}`);
    } catch (error) {
      console.warn(`[dteam.worker] Failed to create worktree, falling back to cwd: ${error}`);
    }
  }

  // 后台执行函数
  const executeInBackground = async () => {
    let finalError: Error | undefined;
    try {
      worker.status = "running";

      const signal = worker.abortController?.signal;
      if (signal?.aborted) throw new Error(`Worker cancelled: ${workerId}`);

      // 1. 构建执行上下文（使用 worktree 路径或原始 cwd）
      const executionCwd = worktreePath || ctx.cwd;
      const context = await worker.contextBuilder.build(worker.config);
      // 如果使用 worktree，覆盖 context 的 cwd
      if (worktreePath) {
        context.cwd = worktreePath;
      }
      // 注入进度回调（供 TUI 实时显示）
      if (onProgress) {
        context.onProgress = onProgress;
      }
      worker.context = context;
      
      // 2. 获取执行器
      const executorFn = getExecutor(executorName);
      
      // 3. 创建包装执行器（适配原有接口）
      //    把 config 存入 WeakMap，让默认 executor 闭包可读
      _configByContext.set(context, worker.config);
      const wrappedExecutor = async (role: string, task: string, style: string) => {
        if (signal?.aborted) throw new Error(`Worker cancelled: ${workerId}`);
        // 使用构建的上下文
        const result = await executorFn(context);
        if (signal?.aborted) throw new Error(`Worker cancelled: ${workerId}`);
        return result;
      };
      
      // 4. 执行任务
      // 关键修复：传 outer workerId（workerId）给 runWorker，让 P2 内部 emit 用此 ID 替换 solo/chain/team-${ts}，
      // 保证 P4 store 的主键与 wrapWorker 传入的 outer ID 一致（多 worker 不互相覆盖）。
      const result = await runWorker(worker.config, worker.bus, worker.memory, wrappedExecutor, workerId);
      if (signal?.aborted) throw new Error(`Worker cancelled: ${workerId}`);
      worker.status = "done";
      
      // worktree 自动清理
      if (useWorktree && worktreePath && worker.config.worktreeAutoCleanup) {
        cleanupWorktree(ctx.cwd, workerId);
      }
      
      // 终态清理:仅后台模式清理大引用(避免 Map 长期持有 ExecutionContext)
      // 前台模式保留 context——workerStart 同步 return 要拼 JSON 给调用方
      if (worker.background) {
        worker.context = undefined;
        worker.abortController = undefined;
      }

      // 5. 保存执行结果到共享内存
      const executionResult = {
        timestamp: Date.now(),
        workerId,
        config: worker.config,
        result,
        success: true,
      };
      
      const results = memory.get('worker', 'results') as any[] || [];
      results.push(executionResult);
      memory.set('worker', 'results', results, 'worker-manager');

      return result;
    } catch (error) {
      finalError = error as Error;
      worker.status = "failed";

      // 保存失败结果到共享内存
      const executionResult = {
        timestamp: Date.now(),
        workerId,
        config: worker.config,
        error: (error as Error).message,
        success: false,
      };

      const results = memory.get('worker', 'results') as any[] || [];
      results.push(executionResult);
      memory.set('worker', 'results', results, 'worker-manager');

      throw error;
    } finally {
      // 关键修复：终态清理
      // 1. P4 注入的 onComplete 回调（让 P4 store 知道 worker 已 done/failed）
      if (onComplete) {
        try {
          onComplete(
            worker.status as "done" | "failed",
            finalError?.message,
          );
        } catch {
          // 回调内部错误吞掉，不影响主流程
        }
      }
      // 2. 失败路径终态清理：同样仅后台模式（前台可能需要 context 用于调试）
      if (worker.background) {
        worker.context = undefined;
        worker.abortController = undefined;
      }
    }
  };

  // 如果是后台执行，立即返回，不等待完成
  if (background) {
    // 启动后台执行
    executeInBackground().catch(() => {});

    return {
      content: JSON.stringify({
        workerId,
        background: true,
        message: `Worker started in background: ${workerId}`,
      }),
    };
  }

  // 前台执行，等待完成
  try {
    const result = await executeInBackground();

    // 前台路径也要触发 onComplete
    onComplete?.(worker.status as "done" | "failed", undefined);

    return {
      content: JSON.stringify({
        workerId,
        result,
        context: worker.context ? {
          task: worker.context.taskContext,
          project: {
            root: worker.context.projectContext.root,
            dependencies: worker.context.projectContext.dependencies.slice(0, 10),
          },
          history: {
            previousResults: worker.context.executionHistory.previousResults.length,
            decisions: worker.context.executionHistory.decisions.length,
            learnings: worker.context.executionHistory.learnings.length,
          },
        } : undefined,
        message: `Worker completed: ${workerId}`,
      }),
    };
  } catch (error) {
    worker.status = "failed";
    // 终态清理
    worker.context = undefined;
    worker.abortController = undefined;
    onComplete?.("failed", (error as Error).message);

    return {
      content: JSON.stringify({
        workerId,
        error: (error as Error).message,
        message: `Worker failed: ${workerId}`,
      }),
    };
  } finally {
    // 前台路径最后清理：return JSON 已拼完，context 可释放
    // 注：executeInBackground 内部已保留 context 给前台 return 用，
    // 这里 finally 统一释放避免 Map 长期持有。
    // 失败路径的清理已在 catch 块中做了，此 finally 主要是正常完成路径的清理。
    if (worker.status === "done") {
      worker.context = undefined;
      worker.abortController = undefined;
    }
  }
}

/**
 * worker.sendSignal — 发送信号到 worker
 */
export async function workerSendSignal(
  ctx: { cwd: string },
  params: { workerId: string; signalType: string; data?: Record<string, unknown> },
): Promise<{ content: string }> {
  const { workerId, signalType, data = {} } = params;
  const worker = workers.get(workerId);

  if (!worker) {
    return {
      content: JSON.stringify({
        error: `Worker not found: ${workerId}`,
      }),
    };
  }

  const allowedSignals: SignalType[] = ["progress", "blocked", "found", "help"];
  if (!allowedSignals.includes(signalType as SignalType)) {
    return {
      content: JSON.stringify({
        error: `Invalid signal type: ${signalType}`,
      }),
    };
  }

  const signal = worker.bus.emit(signalType as SignalType, workerId, data);

  return {
    content: JSON.stringify({
      workerId,
      signal,
      message: `Signal sent: ${signalType}`,
    }),
  };
}

/**
 * worker.saveMemory — 保存共享内存到文件
 */
export async function workerSaveMemory(
  ctx: { cwd: string },
  params: { filepath: string },
): Promise<{ content: string }> {
  const { filepath } = params;
  
  try {
    await memory.save(resolveDteamMemoryPath(ctx.cwd, filepath));
    return {
      content: JSON.stringify({
        filepath,
        message: `Memory saved to: ${filepath}`,
      }),
    };
  } catch (error) {
    return {
      content: JSON.stringify({
        error: (error as Error).message,
        message: `Failed to save memory`,
      }),
    };
  }
}

/**
 * worker.loadMemory — 从文件加载共享内存
 */
export async function workerLoadMemory(
  ctx: { cwd: string },
  params: { filepath: string },
): Promise<{ content: string }> {
  const { filepath } = params;
  
  try {
    await memory.load(resolveDteamMemoryPath(ctx.cwd, filepath));
    return {
      content: JSON.stringify({
        filepath,
        namespaces: memory.namespaces(),
        message: `Memory loaded from: ${filepath}`,
      }),
    };
  } catch (error) {
    return {
      content: JSON.stringify({
        error: (error as Error).message,
        message: `Failed to load memory`,
      }),
    };
  }
}

/**
 * worker.cancel — 取消后台执行的 worker
 */
export async function workerCancel(
  ctx: { cwd: string },
  params: { workerId: string },
): Promise<{ content: string }> {
  const { workerId } = params;
  const worker = workers.get(workerId);

  if (!worker) {
    return {
      content: JSON.stringify({
        error: `Worker not found: ${workerId}`,
      }),
    };
  }

  if (!worker.background) {
    return {
      content: JSON.stringify({
        error: `Worker is not running in background: ${workerId}`,
      }),
    };
  }

  if (worker.abortController) {
    worker.abortController.abort();
  }

  worker.status = "failed";
  // 终态清理
  worker.context = undefined;
  worker.abortController = undefined;

  return {
    content: JSON.stringify({
      workerId,
      message: `Worker cancelled: ${workerId}`,
    }),
  };
}

/**
 * worker.status — 获取 worker 状态
 */
export async function workerStatus(
  ctx: { cwd: string },
  params: { workerId: string },
): Promise<{ content: string }> {
  const { workerId } = params;
  const worker = workers.get(workerId);

  if (!worker) {
    return {
      content: JSON.stringify({
        error: `Worker not found: ${workerId}`,
      }),
    };
  }

  return {
    content: JSON.stringify({
      workerId,
      status: worker.status,
      background: worker.background,
      message: `Worker status: ${worker.status}`,
    }),
  };
}

/**
 * worker.getMemory — 获取共享内存内容
 */
export async function workerGetMemory(
  ctx: { cwd: string },
  params: { namespace?: string; key?: string },
): Promise<{ content: string }> {
  const { namespace, key } = params;
  
  if (namespace && key) {
    // 获取特定键
    const value = memory.get(namespace, key);
    return {
      content: JSON.stringify({
        namespace,
        key,
        value,
        message: value !== undefined ? `Found: ${namespace}.${key}` : `Not found: ${namespace}.${key}`,
      }),
    };
  } else if (namespace) {
    // 获取命名空间下的所有键
    const keys = memory.keys(namespace);
    const values = memory.getMany(namespace, keys);
    return {
      content: JSON.stringify({
        namespace,
        keys,
        values,
        message: `Found ${keys.length} keys in namespace: ${namespace}`,
      }),
    };
  } else {
    // 获取所有命名空间
    const namespaces = memory.namespaces();
    return {
      content: JSON.stringify({
        namespaces,
        message: `Found ${namespaces.length} namespaces`,
      }),
    };
  }
}

// ── 初始化 ────────────────────────────────────────────────────

/**
 * 初始化 worker 工具
 * 
 * 可以在扩展初始化时调用，注册自定义执行器
 */
export function initializeWorkerTools(options?: {
  customExecutors?: Record<string, (context: ExecutionContext) => Promise<string>>;
}): void {
  if (options?.customExecutors) {
    for (const [name, executor] of Object.entries(options.customExecutors)) {
      registerExecutor(name, executor);
    }
  }
}
