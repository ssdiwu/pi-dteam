---
title: "worker 概念（增强版）"
kind: definition
domain: P2-细胞层
status: draft
tags: [worker, 组合层, 增强版]
created: 2026-05-29
updated: 2026-05-30
---

# worker 概念（增强版）

> **定位**：dteam 的组合层。定义 worker 的基本概念。依赖信号类型（P0）。

## 一句话

worker 是 dteam 的**执行引擎**——通过 solo、chain、team 三种模式，实现任务的高效执行。

## 核心特征

| 特征 | 值 |
|------|-----|
| 类型 | 3种：solo / chain / team |
| 通信 | 信号机制（4个信号 + 5个策略 = 9种） |
| 嵌套 | 最大4层 |
| 上下文 | 增强的共享内存 + 上下文构建器 |

## 增强功能

### 1. 增强的共享内存

```typescript
interface EnhancedSharedMemory {
  // 基础操作（兼容原有接口）
  set(namespace: string, key: string, value: unknown, agentId: string): void;
  get(namespace: string, key: string): unknown | undefined;
  keys(namespace: string): string[];
  has(namespace: string, key: string): boolean;
  delete(namespace: string, key: string): boolean;
  clear(namespace: string): void;
  
  // 持久化
  save(filepath: string): Promise<void>;
  load(filepath: string): Promise<void>;
  
  // 批量操作
  setMany(namespace: string, entries: Record<string, unknown>, agentId: string): void;
  getMany(namespace: string, keys: string[]): Record<string, unknown>;
  
  // 查询
  getByPrefix(namespace: string, prefix: string): Record<string, unknown>;
  namespaces(): string[];
  
  // 历史追踪
  history(namespace: string, key: string): MemoryHistoryEntry[];
  
  // 快照
  snapshot(): MemorySnapshot;
  restore(snapshot: MemorySnapshot): void;
}
```

### 2. 上下文构建器

```typescript
interface ExecutionContext {
  // 基础信息
  role: string;
  task: string;
  style: string;
  cwd: string;
  
  // 共享内存
  memory: EnhancedSharedMemory;
  
  // 信号总线
  bus: SignalBus;
  
  // 任务上下文
  taskContext: TaskContext;
  
  // 项目上下文
  projectContext: ProjectContext;
  
  // 执行历史
  executionHistory: ExecutionHistory;
}

class ContextBuilder {
  constructor(
    private cwd: string,
    private memory: EnhancedSharedMemory,
    private bus: SignalBus,
  ) {}
  
  async build(config: WorkerConfig): Promise<ExecutionContext> {
    // 1. 并行获取各种上下文
    const [taskContext, projectContext, executionHistory] = await Promise.all([
      this.buildTaskContext(config.task),
      this.buildProjectContext(),
      this.buildExecutionHistory(),
    ]);
    
    // 2. 存储到共享内存
    // 3. 返回完整上下文
  }
}
```

### 3. 自定义执行器

```typescript
// 注册自定义执行器
registerExecutor("custom", async (context: ExecutionContext) => {
  const { role, task, style, taskContext, projectContext } = context;
  
  // 从共享内存获取历史
  const history = context.memory.get("execution", "history");
  
  // 执行任务
  // ...
  
  return result;
});

// 使用自定义执行器
const result = await workerStart(ctx, { 
  workerId: "worker-123",
  executorName: "custom" 
});
```

## 三种模式

| 模式 | 定位 | 适用场景 |
|------|------|----------|
| **solo** | 有效 | 小任务（<100行，<3文件） |
| **chain** | 综合 | 有冲突的串行任务 |
| **team** | 高效 | 可并行的任务（优先选择） |

## 决策优先级

```
team > solo > chain
```

## 统一配置接口

```typescript
interface WorkerConfig {
  type: "solo" | "chain" | "team";
  task: string;
  style: string;
  options?: WorkerOption[];
}

type WorkerOption = 
  | { type: "role"; value: string }
  | { type: "steps"; value: ChainStep[] }
  | { type: "workers"; value: Worker[] }
  | { type: "rounds"; value: number }
  | { type: "voting"; value: boolean }
  | { type: "maxDepth"; value: number }
  | { type: "debug"; value: boolean };
```

## 配置矩阵

| 字段 | solo | chain | team | 说明 |
|------|------|-------|------|------|
| type | ✅ 必填 | ✅ 必填 | ✅ 必填 | 类型选择 |
| task | ✅ 必填 | ✅ 必填 | ✅ 必填 | 任务描述 |
| style | ✅ 必填 | ✅ 必填 | ✅ 必填 | 思考方式 |
| role | ✅ 必填 | ❌ 忽略 | ❌ 忽略 | 角色名 |
| steps | ❌ 忽略 | ✅ 必填 | ❌ 忽略 | 步骤列表 |
| workers | ❌ 忽略 | ❌ 忽略 | ✅ 必填 | worker列表 |
| rounds | ❌ 忽略 | ❌ 忽略 | ⚪ 可选 | 讨论轮数 |
| voting | ❌ 忽略 | ❌ 忽略 | ⚪ 可选 | 是否投票 |
| maxDepth | ❌ 忽略 | ⚪ 可选 | ❌ 忽略 | 嵌套深度 |
| debug | ⚪ 可选 | ⚪ 可选 | ⚪ 可选 | 调试模式 |

## 工具接口

### worker_create

创建 worker 实例。

```typescript
{
  config: WorkerConfig
}
```

### worker_start

启动 worker 执行。

```typescript
{
  workerId: string,
  executorName?: string  // 可选：指定执行器名称
}
```

### worker_sendSignal

发送信号到 worker。

```typescript
{
  workerId: string,
  signalType: string,
  data?: Record<string, unknown>
}
```

### worker_saveMemory

保存共享内存到文件。

```typescript
{
  filepath: string
}
```

### worker_loadMemory

从文件加载共享内存。

```typescript
{
  filepath: string
}
```

### worker_getMemory

获取共享内存内容。

```typescript
{
  namespace?: string,
  key?: string
}
```

## 模式详情

详见：
- [solo.md](./solo.md)：solo 编排模式
- [chain.md](./chain.md)：chain 编排模式
- [team.md](./team.md)：team 编排模式

## 嵌套规则

| 规则 | 说明 |
|------|------|
| solo 不能嵌套 | 叶子节点，不可再分 |
| chain steps 可嵌套 | steps 中可包含 solo 和 team |
| team workers 可嵌套 | workers 中可包含 solo 和 chain |
| 最大深度四层 | 防止过度嵌套 |

## 信号机制

worker 通过信号总线进行即时通信：

| 类别 | 信号 | 说明 |
|------|------|------|
| 状态报告 | progress, blocked, found | worker 报告当前状态 |
| 协调请求 | help | worker 请求外部帮助 |
| 策略恢复 | retry, adjust, switch, replan, learn | 自动恢复机制 |

详见 [信号类型.md](../P0-原子层/信号类型.md)

## 不变量

1. solo 必须有 role
2. chain 必须有 steps
3. team 必须有 workers
4. 嵌套深度不超过四层

## 使用示例

### 基本使用

```typescript
// 1. 创建 worker
const { workerId } = await workerCreate(ctx, {
  config: {
    type: "solo",
    task: "实现用户登录功能",
    style: "explore",
    options: [{ type: "role", value: "build" }],
  },
});

// 2. 启动执行
const result = await workerStart(ctx, { workerId });

// 3. 查看结果
console.log(result);
```

### 使用自定义执行器

```typescript
// 1. 注册执行器
registerExecutor("custom", async (context) => {
  // 从上下文获取信息
  const { role, task, taskContext, projectContext } = context;
  
  // 执行任务
  // ...
  
  return result;
});

// 2. 创建并启动 worker
const { workerId } = await workerCreate(ctx, { config });
const result = await workerStart(ctx, { 
  workerId,
  executorName: "custom" 
});
```

### 多 worker 协作

```typescript
// 1. 探索阶段
const exploreResult = await workerStart(ctx, { 
  workerId: exploreWorkerId 
});

// 2. 设计阶段（从共享内存获取探索结果）
const designResult = await workerStart(ctx, { 
  workerId: designWorkerId 
});

// 3. 实现阶段（从共享内存获取设计决策）
const buildResult = await workerStart(ctx, { 
  workerId: buildWorkerId 
});
```
