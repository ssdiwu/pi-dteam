# types/

dteam 的类型定义。纯类型，无运行时逻辑。

## 文件

| 文件 | 内容 |
|---|---|
| `dispatch.ts` | **0.7 档位派发契约**：`Tier` / `ThinkingLevel` / `DispatchRequest` / `DispatchResult` / 档位模型路由 |
| `loop.ts` | 0.6 核心类型；旧 loop 退场前的兼容遗留 |
| `role.ts` | 0.6 `RoleName`；五角色执行链退场前的兼容遗留 |
| `signal.ts` | `Signal`：`progress` / `found` / `blocked` / `help` 四类信号 |
| `context.ts` | `DteamContext`：信号通路上下文（`signalBus` / `runsStore` / `runId` / `workerId` / 补充队列 / 注入队列）。**注意**：`runsStore` / `runId` 是 0.5.0 桥接残留，0.6.0 主循环用 `summonTrail` 替代 |
| `run.ts` | 0.5.0 旧运行结构：`ExecutionPlan` / `PlanStep` / `RunResult` / `StepResult` 等。**0.6.0 已被 `loop.ts` 的 SummonStep/DteamResult6 取代**，保留兼容历史接口，新增设计不应围绕它扩展（见 ADR 0005 已推翻清单） |

## 关系

被所有 src 子目录引用。0.7 dispatch 内核使用 `dispatch.ts`；仍在运行的 0.6 loop 使用 `loop.ts` / `role.ts` / `signal.ts`。`context.ts` / `run.ts` 是旧桥接层，随旧 runtime 退场。

对应数据结构见 `doc/10-架构与运行/10-系统架构.md`。

详见 ADR 0005（召唤池重定义）。