# dteam 内部架构

> `src/` 是 0.8 会话级后台运行时：主代理按 ADR 0020 分轮定义证据问题、综合 finding 并主动协调，Worker Manager 只执行已提交的独立 worker；主动协调边界见 ADR 0024。

## 运行路径

```text
主模型
  └─ dteam_dispatch / dteam_respond / dteam_control / dteam_recover / dteam_wait [../index.ts]
       ├─ WorkerManager [runtime/worker-manager.ts]
       │   ├─ WorkerRecord + AgentSession + AbortController
       │   ├─ SignalLog + RequestState + pending parent events
       │   ├─ dteam-usage.jsonl numeric ledger
       │   └─ shared AdaptiveConcurrency
       └─ createWorkerSession() [session.ts]
            └─ fresh AgentSession + selected provider ModelRuntime + Logical Isolation + tool policy
```

## 文件职责

| 路径 | 职责 |
|---|---|
| `runtime/worker-manager.ts` | 生命周期、后台派发、显式依赖等待、同档候选、timeout recovery、实时 Snapshot、finding/parent event、主动控制、聚合、取消和 session shutdown |
| `runtime/signal-log.ts` | append-only Signal Log 与 Snapshot 投影 |
| `runtime/request-state.ts` | workerId/requestId 作用域的 deferred request |
| `runtime/signal-tool.ts` | worker 专用 `dteam_signal` |
| `runtime/report-tool.ts` | 统一 `dteam_report` schema 与 parser；校验 outcome、activities、facts 和 verification 的交叉不变量 |
| `runtime/tool-policy.ts` | addTools 精确校验和 built-in-only 降级边界 |
| `runtime/usage-ledger.ts` | 独立 dteam worker 用量账本的数字白名单、去重键和安全追加写入 |
| `runtime/types.ts` | 五工具、worker、report/handoff、finding、control、writeScope、wait 与 parent event 的运行时契约 |
| `tui/dteam-dialog.ts` | `/dteam` 列表、详情和终态只读渲染 |
| `tui/tool-result.ts` | 公开工具的摘要与 Ctrl+O 人类可读详情投影 |
| `tui/cancel.ts` | 用户取消二次确认 |
| `session.ts` | fresh worker session、所选 provider runtime/config 传播、候选注册和首次 active set 收窄 |
| `session/*` | 模型配置、候选解析、档位默认值和受控资源加载 |
| `dispatch/*` | 模型路由和 Adaptive Concurrency |
| `types/dispatch.ts` | T1/T2/T3、模型路由与候选解析契约 |
| `duration.ts` | 内部毫秒值到用户可读秒/分秒的统一格式化 |

## 不变量

1. 模型侧真实工具是 `dteam_dispatch`、`dteam_respond`、`dteam_control`、`dteam_recover` 与 `dteam_wait`；`/dteam` 是独立管理命令。
2. Worker Manager 不保存 batch、依赖图、dgoal ID 或下一轮派发决定。
3. worker 只经 Manager 与主代理协作，不 P2P。
4. 所有档位默认只读；写工具必须经每次 `addTools` 最小授权并声明 `writeScope`。动态工具必须先注册再激活；未知名 fail-closed。worker 只复制所选模型的 provider runtime/config，不加载该 provider 扩展的工具；第三方 extension 工具当前降级拒绝。
5. shutdown / reload 中止活跃 worker，不 resume；completed/failed/timed_out/cancelled/shutdown 只读封存。
6. worker 结束前必须经 `dteam_report` 区分任务 outcome、实际 activities、facts 与 verification；缺报告或旧/非法形状失败。Manager completed 不代表任务或验证通过。facts 在 completed event 注入真实 workerId，verification 不进入 handoff。可写 worker 中断回传 `write_interrupted`，由主 LLM 派 fresh T3 检查。
7. 实时流只投影到 Snapshot 并经节流上抛，不用 `display: true` 原样写入主对话；用户通过 `/dteam` 查看实时状态。只有带证据且可能改变路径的 finding 进入 parent event；普通 progress 不唤醒主模型。
8. parent event 先进入 Manager 待消费队列；`dteam_wait` 消费后即删除，或在主代理 idle / settled 后异步回放，二者单次消费。无 writeScope 且没有 assistant 文本和 WorkerReport 的失败仅供后续 wait 消费，仍可在 `/dteam` 查看；主动 cancel/stop 的旧事件会按协议清理。
9. worker session 继续保持 in-memory；每条 assistant message 只把脱敏数字 usage 写入 `~/.pi/agent/dteam-usage.jsonl`，不持久化 worker transcript。
