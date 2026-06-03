# P0 — 原子层

> 不依赖其他层，只定义类型、配置和纯函数。

## 模块清单

| 文件 | 职责 |
|------|------|
| `config.ts` | WorkerConfig 定义、options 读取与归一化工具（含 worktree/concurrencyMode 字段） |
| `dteamConfig.ts` | dteam 三层配置加载（内置 → 全域 → 项目），支持 useCurrentModel |
| `adaptiveConcurrency.ts` | 自适应并发控制器：状态机 + 系统采样器 + 过载保护 |
| `signal.ts` | **信号（信息素）类型**：4 种 SignalType（progress/blocked/found/help）+ 5 种 StrategyType（retry/adjust/switch/replan/learn）；信号是 dteam 信息素系统的原子通信单元 |
| `signalEvent.ts` | **信号事件（信息素数据单元）**：基于 SignalType 扩展的持久化形态，增加 TTL 衰减、taskId 关联、severity 分级、refs 依赖引用、artifacts 产出文件；提供 `computeExpiresAt()` / `isExpired()` 工具 |
| `workItem.ts` | **workItem 数据模型**：运行态任务池的最小调度单元；包含 `WorkItem` / `RunState` / `WorkItemStatus` / `ExecutionStrategy` / `AcceptanceModel` 等类型，以及 `parseAcId()` / `extractAcceptanceModel()` 双层验收解析器（与 chainPlanner / contextBuilder 共用） |
| `status.ts` | WorkerStatus 和 TaskStatus 类型定义 |
| `stateMachine.ts` | 任务状态转换验证（终态、合法转换） |
| `memory.ts` | MemoryAdapter 接口定义 |
| `atomic.ts` | 原子操作：atomicCommit（git add+commit）、atomicWrite（tmp+rename） |
| `auth.ts` | 认证相关类型：User、AuthConfig、TokenPayload、AuthResponse |
| `concurrency.ts` | 并发控制：mapWithConcurrencyLimit、withTimeout |
| `gateChecks.ts` | 门控检查：8 项准入检查 |
| `loopDetector.ts` | 循环检测：防止重复调用和渐进式参数变化 |
| `i18n.ts` | 国际化：locale 检测和翻译函数 |
| `reference.ts` | 参考数据查询：architecture（TOML 搜索） |
| `pathSafety.ts` | 路径安全：文件名净化、路径边界检查、memory 路径沙箱 |

## 依赖关系

```
本层不依赖任何其他层。
所有类型和纯函数在此定义，供上层使用。
```
