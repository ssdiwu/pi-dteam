# dteam 内部架构

> `src/` 是 0.8 会话级后台运行时：主模型负责路由，Worker Manager 只执行已提交的独立 worker。

## 运行路径

```text
主模型
  └─ dteam({ type: dispatch | respond }) [../index.ts]
       ├─ WorkerManager [runtime/worker-manager.ts]
       │   ├─ WorkerRecord + AgentSession + AbortController
       │   ├─ SignalLog + RequestState
       │   └─ shared AdaptiveConcurrency
       └─ createWorkerSession() [session.ts]
            └─ fresh AgentSession + Logical Isolation + tool policy
```

## 文件职责

| 路径 | 职责 |
|---|---|
| `runtime/worker-manager.ts` | 生命周期、后台派发、回退、聚合、取消和 session shutdown |
| `runtime/signal-log.ts` | append-only Signal Log 与 Snapshot 投影 |
| `runtime/request-state.ts` | workerId/requestId 作用域的 deferred request |
| `runtime/signal-tool.ts` | worker 专用 `dteam_signal` |
| `runtime/tool-policy.ts` | addTools 精确校验和 built-in-only 降级边界 |
| `tui/dteam-dialog.ts` | `/dteam` 列表、详情和终态只读渲染 |
| `tui/cancel.ts` | 用户取消二次确认 |
| `leaf.ts` | 保留 0.7 dispatch 的模型路由/执行辅助，后台 Manager 迁移其回退行为 |
| `session.ts` | fresh worker session、候选注册和首次 active set 收窄 |
| `dispatch/*` | 模型路由和 Adaptive Concurrency |
| `types/dispatch.ts` | T1/T2/T3 与历史 dispatch 类型 |

## 不变量

1. 模型侧唯一真实工具名是 `dteam`；`/dteam` 是独立管理命令。
2. Worker Manager 不保存 batch、依赖图、dgoal ID 或下一轮派发决定。
3. worker 只经 Manager 与主代理协作，不 P2P。
4. 动态工具必须先注册再激活；未知名 fail-closed。第三方 extension 当前降级拒绝。
5. shutdown / reload 中止活跃 worker，不 resume；completed/failed/timed_out/cancelled/shutdown 只读封存。
