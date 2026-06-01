# dteam-spawn-借鉴-pi-subagents-设计模式

## 基本信息
- ID: 20260601135506-pubh
- 类型: infra
- 创建时间: 2026-06-01T05:55:06.803Z
- 状态: todo

## 目标
- 为什么: pi-subagents 实现了丰富的 subagent 能力（progress tracking、control config、artifacts、model fallback），dteam 的 spawnAgent 目前只有基础能力。需要借鉴 pi-subagents 的设计模式，增强 dteam 的 spawnAgent。
- 做什么: 借鉴 pi-subagents 的 4 个设计模式增强 dteam spawnAgent：B1 增强 model fallback（27 个正则 + bare model name 解析）、B2 增加 AgentProgress（实时进度跟踪）、B3 增加 ControlConfig（needs_attention 触发）、B4 增加 ArtifactConfig（input/output 持久化）。

## 范围

### 包含

- **B1 模型解析**：在 `src/P1/spawn.ts` 补 27 个正则 + bare model name 兜底（参考 pi-subagents 源码 `modelResolve.ts`）；fallback 链触发后退避重试
- **B2 AgentProgress 输出**：spawn 内部维护 `{startTime, currentTool, recentOutput, tokenCount, status}` 状态，通过 callback 暴露给 `src/P2/worker.ts`，最终喂给 worker widget
- **B3 决策上抛（spawn 端部分）**：worker 在 `blocked` 时通过 `bus.emit('blocked', ...)` 发信号；EventStream 持久化由 mtgl 实施 task 承担
- **B4 ArtifactConfig 落盘**：spawn.input 写到 `.dteam/spawn/<runId>/input.md`，spawn.output 写到 `output.md`；失败时单独写 `error.md` 保留可读性
- 与 EventStream / TUI 全屏 / 调度入口的**契约文档化**（不实施，只写边界）

### 排除

- EventStream 持久化（信息素层实施 task 独立承担）
- TUI 全屏渲染（独立 task）
- 调度入口 / 自动编排（独立 task）
- v0.4.0 spawn 现有 model/fallback 解析的重复改造（只补缺失部分）
- 跨进程 / 多会话 fanout

## 验收条件（GWT + 测试）

- [ ] AC1 B1 模型解析：支持 27 个正则 + bare name 兜底；fallback 链触发后退避重试（模型解析已完成，运行时 fallback 退避重试待 check 复核）
- [x] AC2 B2 AgentProgress：spawn 内部维护 `{startTime, currentTool, recentOutput, tokenCount, status}` 状态，通过 callback 暴露给 `worker.ts`；worker widget 能消费（即使只显示 start/end 字段也算部分通过）
- [x] AC3 B3 spawn 端信号：worker 在 `blocked` 时通过 `bus.emit('blocked', ...)` 发信号；EventStream 端持久化由 mtgl 实施 task 承接
- [x] AC4 B4 Artifact 落盘：spawn.input → `.dteam/spawn/<runId>/input.md`，spawn.output → `output.md`；失败时 → `error.md`
- [x] AC5 兼容：现有 v0.4.0 `spawn.ts` API 签名不变；`worker.ts` 接入点不破坏
- [x] AC6 契约文档：spawn ↔ EventStream ↔ TUI widget ↔ 调度入口的边界与依赖关系写入 task「阶段记录→讨论决策」section

## 阶段记录

### 探索发现

- dteam `spawnAgent` 已走 Pi SDK `createAgentSession` 真 LLM 路径。
- 当前增强围绕 4 条链路：model 解析、progress 进度、blocked 信号、artifact 落盘。

### 讨论决策

#### spawn ↔ EventStream ↔ TUI widget ↔ 调度入口契约

- `spawnAgent(options)` 保持既有 `SpawnOptions / SpawnResult / SpawnUsageStats` 字段兼容。
- 模型解析顺序：
  1. `provider/id` 显式格式直通 `ModelRegistry.find(provider, id)`；
  2. bare/别名模型名走 `MODEL_PARSE_PATTERNS` 映射到 `provider/id`；
  3. 未命中时保留旧兜底：依次尝试 `anthropic/openai/google`。
- `AgentProgress` 由 `spawn.ts` 内部维护，字段为：`startTime/currentTool/recentOutput/tokenCount/status`。
- `onUpdate` 在 text delta、turn end、message end 时返回 `{ output, progress }`，旧调用方只读取 `output` 仍兼容。
- `onToolEvent` 保持 `{ type: "start" | "end", toolName? }`，兼容扩展可选 `progress`，供 worker widget 消费 current tool/status。
- worker 调度入口（`P2/worker.ts`、P4 注册的 `llm` executor）在 `spawnAgent` 返回 model/spawn error 时通过 `context.bus.emit("blocked", ...)` 发 blocked 信号。
- EventStream 不直接依赖 spawn；它只订阅 SignalBus 的 4 类信号并持久化到 SignalLog。因此 blocked 信号由 worker 层发出，EventStream 自动归档。
- artifact 落盘由 `spawnAgent` 内部在传入 `cwd` 时执行：
  - `.dteam/spawn/<runId>/input.md`
  - `.dteam/spawn/<runId>/output.md`
  - `.dteam/spawn/<runId>/error.md`
- artifact 写入失败只 warn，不影响 LLM 主流程，避免日志/磁盘问题中断 worker。

### 执行记录

- 已实现 27 条 `MODEL_PARSE_PATTERNS`。
- 已实现 `AgentProgress` 并通过 `onUpdate` / `onToolEvent` 兼容扩展字段暴露。
- 已实现 model/spawn error → `blocked` signal。
- 已实现 spawn input/output/error artifact 落盘。
- 已将 `spawn.ts` 主流程拆分为 7 个 step helper，并拆分事件处理 helper，当前函数长度检查未发现 >50 行函数。
- 已补充测试：模型别名、progress 推送、tool progress、prompt 失败 dispose、artifact 成功/失败落盘。

### 收口记录
（待填写）

