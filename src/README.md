# dteam 内部架构

> `src/` 是 0.8 会话级后台运行时：主模型负责路由，Worker Manager 只执行已提交的独立 worker。

## 运行路径

```text
主模型
  └─ dteam_dispatch / dteam_respond / dteam_recover / dteam_wait [../index.ts]
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
| `runtime/worker-manager.ts` | 生命周期、后台派发、显式依赖等待、同档候选、timeout recovery、实时 Snapshot、聚合、取消和 session shutdown |
| `runtime/signal-log.ts` | append-only Signal Log 与 Snapshot 投影 |
| `runtime/request-state.ts` | workerId/requestId 作用域的 deferred request |
| `runtime/signal-tool.ts` | worker 专用 `dteam_signal` |
| `runtime/report-tool.ts` | worker 完成前必需的结构化 `dteam_report` |
| `runtime/tool-policy.ts` | addTools 精确校验和 built-in-only 降级边界 |
| `runtime/types.ts` | 四工具、worker、report/handoff、writeScope、wait 与 parent event 的运行时契约 |
| `tui/dteam-dialog.ts` | `/dteam` 列表、详情和终态只读渲染 |
| `tui/tool-result.ts` | 公开工具的摘要与 Ctrl+O 人类可读详情投影 |
| `tui/cancel.ts` | 用户取消二次确认 |
| `session.ts` | fresh worker session、候选注册和首次 active set 收窄 |
| `session/*` | 模型配置、候选解析、档位默认值和受控资源加载 |
| `dispatch/*` | 模型路由和 Adaptive Concurrency |
| `types/dispatch.ts` | T1/T2/T3、模型路由与候选解析契约 |
| `duration.ts` | 内部毫秒值到用户可读秒/分秒的统一格式化 |

## 不变量

1. 模型侧真实工具是 `dteam_dispatch`、`dteam_respond`、`dteam_recover` 与 `dteam_wait`；`/dteam` 是独立管理命令。
2. Worker Manager 不保存 batch、依赖图、dgoal ID 或下一轮派发决定。
3. worker 只经 Manager 与主代理协作，不 P2P。
4. 所有档位默认只读；写工具必须经每次 `addTools` 最小授权并声明 `writeScope`。动态工具必须先注册再激活；未知名 fail-closed。第三方 extension 当前降级拒绝。
5. shutdown / reload 中止活跃 worker，不 resume；completed/failed/timed_out/cancelled/shutdown 只读封存。
6. worker 结束前必须经 `dteam_report` 报告结构化事实；缺报告失败。可写 worker 中断回传 `write_interrupted`，由主 LLM 派 fresh T3 检查。
7. 实时流只投影到 Snapshot 并经节流上抛，不用 `display: true` 原样写入主对话；用户通过 `/dteam` 查看实时状态。
