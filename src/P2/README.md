# P2 — 细胞层

> 依赖 P0 + P1，提供编排模式和上下文构建。

## 模块清单

| 文件 | 职责 |
|------|------|
| `solo.ts` | Solo 模式：单角色执行，最小编排单元 |
| `chain.ts` | Chain 模式：顺序执行多个 step，前一步失败则停止 |
| `team.ts` | Team 模式：并行执行多个 worker，支持并发控制和超时 |
| `contextBuilder.ts` | 上下文构建器：构建 task/project/execution 三维执行上下文 |
| `authModule.ts` | 认证模块：封装 AuthService 为高层接口 |
| `worker.ts` | worker 管理工具：create/start/sendSignal/cancel/status/saveMemory/loadMemory/getMemory；默认 executor 调真 LLM（加载 `agents/<role>.md` + 调 `spawnAgent`），不再走 mock 模板 |
| `eventStream.ts` | 事件流桥接器：SignalBus ↔ SignalLog（订阅 bus 4 类信号自动 append 到 log，view 合并内存+文件去重，seal 收口归档）（信息素层 P2 桥接层） |

## 依赖关系

```
P2 → P1 → P0
```

## 执行模式

```
solo:  role → executor → result
chain: step1 → step2 → ... → stepN（顺序，后续 step 会收到上一 step 输出）
team:  worker1 ‖ worker2 ‖ ... ‖ workerN（并行）
```

## 上下文构建流程

ContextBuilder.build() 做三件事：
1. **buildTaskContext** — 从 `.dteam/task/*.md` 解析任务元数据和阶段记录
2. **buildProjectContext** — 扫描目录结构、package.json、相关文件
3. **buildExecutionHistory** — 从共享内存读取历史执行结果

最终拼成 `ExecutionContext` 传给 executor。

## Executor 优先级

默认 executor 调真 LLM，参数优先级：
1. `WorkerConfig.model`（用户显式传） — 最高
2. `agents/<role>.md` frontmatter `model`（role 默认）
3. `sessionModel`（当前会话模型，P4 入口在 `model_select` 事件中更新）— 兜底

`fallbackModels` 同上优先级链。worker 终态（done/failed/cancelled）会释放大引用（context + abortController）避免内存泄漏。