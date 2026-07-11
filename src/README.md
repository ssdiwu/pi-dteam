# dteam 内部架构

> 先读 [`../doc/README.md`](../doc/README.md) 看产品与决策，再读本文件定位实现。

`src/` 是 ADR 0008 定义的模型分级路由执行层：没有 Orchestrator Loop、Signal Store、五角色、独立 UI 或 task plan。

## 运行路径

```text
主模型（T1）
  └─ dteam_dispatch(task, tier, thinking?, tools?)  [../index.ts]
       ├─ dispatch()                                [leaf.ts]
       │   ├─ tier model chain + provider fallback  [dispatch/model-routing.ts]
       │   ├─ shared adaptive concurrency            [dispatch/concurrency.ts]
       │   └─ T1 hard fallback, timeout, cancellation
       └─ createWorkerSession()                     [session.ts]
            └─ fresh AgentSession + Logical Isolation + SessionManager.inMemory()
```

`dteam_dispatch` 直接向主对话返回结构化 `DispatchResult`。主模型自行 fan-out、收结果，并在关键任务按需派发 T1 只读 fresh 验收。

## 文件职责

| 路径 | 职责 |
|---|---|
| `config.ts` | dispatch 总超时、abort 宽限期与单 worker 工具调用上限 |
| `leaf.ts` | dispatch 执行、同档模型链、T1 回退、timeout/cancellation、权限上限 |
| `session.ts` | fresh worker `AgentSession` 工厂 |
| `session/tier-config.ts` | T1/T2/T3 默认 prompt、thinking、工具，以及显式环境模型路由 |
| `session/model-resolver.ts` | `provider/id` 到 Pi Model 的解析 |
| `session/resource-loader.ts` | Logical Isolation 使用的最小 ResourceLoader |
| `dispatch/*` | 无状态模型路由与 Adaptive Concurrency |
| `types/dispatch.ts` | 唯一运行时契约：请求、结果、档位与模型链 |
| `tools.ts` | 对外 dispatch 类型 re-export |

## 不变量

1. 只公开 `dteam_dispatch`；不提供 status/plan/check 等旁路工具。
2. worker 是每次创建的进程内 fresh session，使用最小 ResourceLoader 与 `SessionManager.inMemory()`。
3. 模型档位只来自 `DTEAM_T1/T2/T3_MODEL` 与 `_FALLBACK_MODELS` 显式配置；未配置 primary 才回落 `ctx.model`。
4. 请求档解析的工具集是整个 fallback 链的权限上限；T3 默认只读，即使回退 T1 也不扩权。
5. 主模型负责并行、验收与收口；源码不重新引入 loop、signal、resume 或 UI 调度层。
