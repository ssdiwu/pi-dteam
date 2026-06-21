# types/

dteam 的类型定义。纯类型，无运行时逻辑。

## 文件

| 文件 | 内容 |
|---|---|
| `loop.ts` | **0.6.0 核心类型**：`SummonStep` / `OrchestratorDecision` / `CheckResult` / `DteamResult6` / `ISignalStore` / `LoopConfig` / `DEFAULT_LOOP_CONFIG` |
| `role.ts` | `RoleName`：`explore` / `design` / `build` / `check` / `close`（固定五角色，见 ADR 0002） |
| `signal.ts` | `Signal`：`progress` / `found` / `blocked` / `help` 四类信号 |
| `context.ts` | `DteamContext`：信号通路上下文（`signalBus` / `runsStore` / `runId` / `workerId` / 补充队列 / 注入队列）。**注意**：`runsStore` / `runId` 是 0.5.0 桥接残留，0.6.0 主循环用 `summonTrail` 替代 |
| `run.ts` | 0.5.0 旧运行结构：`ExecutionPlan` / `PlanStep` / `RunResult` / `StepResult` 等。**0.6.0 已被 `loop.ts` 的 SummonStep/DteamResult6 取代**，保留兼容历史接口，新增设计不应围绕它扩展（见 ADR 0005 已推翻清单） |

## 关系

被所有 src 子目录引用。0.6.0 新代码只用 `loop.ts` / `role.ts` / `signal.ts`；`context.ts` / `run.ts` 是桥接层兼容用。

对应数据结构见 `doc/10-架构与运行/10-系统架构.md`。

详见 ADR 0005（召唤池重定义）。