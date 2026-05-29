/**
 * worker 工具实现（增强版）
 *
 * 3个工具：worker.create/start/sendSignal
 * 
 * 增强功能：
 * 1. 使用增强的共享内存
 * 2. 使用上下文构建器
 * 3. 支持真实的执行器
 */

import { WorkerConfig } from "../P0/config.js";
import { SignalBus } from "../P1/signalBus.js";
import { EnhancedSharedMemory, createEnhancedSharedMemory } from "../P1/enhancedSharedMemory.js";
import { ContextBuilder, createContextBuilder, ExecutionContext, Executor } from "../P2/contextBuilder.js";
import { runWorker } from "../P3/worker.js";

// ── 全局状态 ──────────────────────────────────────────────────

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

const bus = new SignalBus();
const memory = createEnhancedSharedMemory();

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
 */
function getExecutor(name?: string): (context: ExecutionContext) => Promise<string> {
  if (name && executorRegistry.has(name)) {
    return executorRegistry.get(name)!;
  }
  
  // 默认执行器：使用上下文构建器创建
  return async (context: ExecutionContext) => {
    const { role, task, style, taskContext, projectContext } = context;
    
    // 构建执行提示
    const prompt = buildExecutionPrompt(context);
    
    // 这里应该调用真实的 LLM 或执行器
    // 目前返回模拟结果
    return `[${role}] 执行任务: ${task}
    
任务详情:
- 目标: ${taskContext.goal}
- 类型: ${taskContext.type}
- 状态: ${taskContext.status}

项目信息:
- 根目录: ${projectContext.root}
- 依赖: ${projectContext.dependencies.slice(0, 5).join(', ')}

执行风格: ${style}`;
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
 * worker.create — 创建 worker 实例
 */
export async function workerCreate(
  ctx: { cwd: string },
  params: { config: WorkerConfig },
): Promise<{ content: string }> {
  const { config } = params;
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
 */
export async function workerStart(
  ctx: { cwd: string },
  params: { workerId: string; executorName?: string; background?: boolean },
): Promise<{ content: string }> {
  const { workerId, executorName, background = false } = params;
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

  // 后台执行函数
  const executeInBackground = async () => {
    try {
      worker.status = "running";
      
      // 1. 构建执行上下文
      const context = await worker.contextBuilder.build(worker.config);
      worker.context = context;
      
      // 2. 获取执行器
      const executorFn = getExecutor(executorName);
      
      // 3. 创建包装执行器（适配原有接口）
      const wrappedExecutor = async (role: string, task: string, style: string) => {
        // 使用构建的上下文
        const result = await executorFn(context);
        return result;
      };
      
      // 4. 执行任务
      const result = await runWorker(worker.config, worker.bus, worker.memory, wrappedExecutor);
      worker.status = "done";

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

    return {
      content: JSON.stringify({
        workerId,
        error: (error as Error).message,
        message: `Worker failed: ${workerId}`,
      }),
    };
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

  const signal = worker.bus.emit(signalType as any, workerId, data);

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
    await memory.save(filepath);
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
    await memory.load(filepath);
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
