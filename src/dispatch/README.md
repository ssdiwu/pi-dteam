# dispatch/

`dteam` 后台 Worker Manager 的无状态模型路由与并发支撑模块。

| 文件 | 职责 |
|---|---|
| `concurrency.ts` | `AdaptiveConcurrency`（自适应并发）：按 429（限流）调节并发槽；不维护任务队列或编排循环。 |
| `model-routing.ts` | 显式主模型 + `FallbackModels`（回退模型链）解析；未配置 primary 才回落 `ctx.model`，不按模型名称或价格猜档。 |

Worker Manager 使用本目录完成 fresh 模型路由和共享并发；项目根 [`index.ts`](../../index.ts) 对外注册五工具。主模型负责路由、证据综合、主动协调和并行 fan-out；本目录不创建 Orchestrator Loop（编排循环）、Signal Store（信号存储）或持久 task plan（任务计划）。
