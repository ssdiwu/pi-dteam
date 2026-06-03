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
| `worker.ts` | worker 管理工具：create/start/sendSignal/cancel/status/saveMemory/loadMemory/getMemory；默认 executor 调真 LLM（加载 `agents/<role>.md` + 调 `spawnAgent`），不再走 mock 模板；支持 worktree 隔离和 AgentProgress 数据通路 |
| `eventStream.ts` | **事件流桥接器（信息素桥接层）**：SignalBus ↔ SignalLog 自动同步；start() 订阅 bus 4 类信号自动 append 到 log，view() 合并内存+文件去重，seal() 收口归档 |

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

## 失败诊断与观测键（新增）

当 `worker_start` 进入关键阶段或失败时，会向共享内存写入 `worker-<workerId>` 诊断键：

- `status`：当前状态（started/failed/done）
- `startedAt` / `endedAt`：起止时间戳
- `lastPhase`：最近阶段（如 `worker_start` / `runWorker`）
- `lastError`：失败原因（仅失败路径）
- `config`：启动时的 worker 配置快照

这样即使 worker 快速 failed，也能通过 `worker_getMemory` 获取可复盘的上下文。

## 信息素驱动调度（现状与待办）

### ✅ 已完成：信息素基础设施

| 能力 | 状态 | 实现位置 |
|------|------|----------|
| 信号类型定义（4 种） | ✅ | `P0/signal.ts` |
| 信号事件数据单元（TTL + refs + severity） | ✅ | `P0/signalEvent.ts` |
| 进程内实时 pub/sub | ✅ | `P1/signalBus.ts` |
| 文件持久化（JSONL + TTL + rotate + seal） | ✅ | `P1/signalLog.ts` |
| bus ↔ log 自动桥接 + 去重合并 | ✅ | `P2/eventStream.ts` |
| UI 信号角标 + Tab 面板展示 | ✅ | `P4/worker-widget.ts` |
| 手动信号发送工具（signal_emit / worker_sendSignal） | ✅ | `P1/signal.ts` / `P2/worker.ts` |
| 信号历史查询工具（signal_history） | ✅ | `P1/signal.ts` |

### 🔄 进行中 / 待实现：信息素驱动调度决策

参考蚁群（ant-colony）的信息素调度，以下能力**基础设施已具备，但尚未接入调度逻辑**：

| 能力 | 描述 | 蚁群对应 | 实现复杂度 |
|------|------|----------|------------|
| **任务优先级加权** | 根据 progress/found 信号提升相关任务优先级，根据 blocked 信号降低 | `claimNextTask()` 信息素评分 | 中：P3 编排器读 EventStream.view() 加权排序 |
| **错误模式追踪** | 同类 blocked 信号 ≥ N 次时自动分类（type_error/timeout/rate_limit 等），生成诊断任务 | `classifyError()` + 诊断任务生成 | 中：P1 signalLog 加 pattern recognizer |
| **自动信号发射** | Worker 执行过程中自动 emit progress/blocked（不依赖 LLM 显式调工具） | 蚂后 onSignal 回调 + spawner 自动 emit | 低：spawn.ts 的 handleToolEvent/handleMessageEnd 里加 bus.emit |
| **依赖感知调度** | 基于 SignalEvent.refs（文件路径）检测冲突，防止并行 worker 同时修改同一文件 | `deps.ts` import graph + 文件锁 | 中：team.ts 启动前查 refs 冲突 |
| **负反馈循环** | blocked/refused 信号 → 降低相关文件/任务优先级 → 后续 step 避开 | repellent 信息素 | 低：P3 编排器加权时减分 |
| **预算温度控制** | cost 超阈值时只执行 priority 任务，禁止新 explore | 巢穴温度 + 预算刹车 | 高：需要 cost 追踪集成 |

### 接入点建议

```
自动信号发射：
  P1/spawn.ts:handleToolEvent()   → bus.emit('progress', workerId, { tool, file })
  P1/spawn.ts:handleMessageEnd()    → bus.emit('progress'/'blocked', workerId, { status, error })

任务优先级加权：
  P3/worker.ts:runTeam()          → 启动前从 EventStream.view() 读历史信号
                                   → 按信号密度调整 worker 启动顺序

错误模式追踪：
  P1/signalLog.ts                  → 新增 analyzePatterns() 方法
                                   → P3 编排器在失败时调用 → 决定 retry / switch / replan
```
