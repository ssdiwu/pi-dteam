# dispatch/

`dteam_dispatch`（团队派发）的无状态执行支撑模块。

| 文件 | 职责 |
|---|---|
| `concurrency.ts` | `AdaptiveConcurrency`（自适应并发）：按 429（限流）调节并发槽；不维护任务队列或编排循环。 |
| `model-routing.ts` | 显式主模型 + `FallbackModels`（回退模型链）解析；不按模型名称或价格猜档。 |

`leaf.ts` 的 `dispatch(request, ctx)` 已通过 `session.ts` 使用本目录完成单次 fresh dispatch；对外 `index.ts` 工具注册仍在后续任务替换。主模型本身负责路由和并行 fan-out；本目录不创建 Orchestrator Loop（编排循环）、Signal Store（信号存储）或持久 task plan（任务计划）。
