# runtime/

0.8 的会话级后台运行时。这里仅管理当前 Pi 会话内已提交 worker 的生命周期、signal、候选工具和回传；不保存 batch、依赖图、dgoal 状态或跨进程恢复数据。

| 文件 | 职责 |
|---|---|
| `tool-policy.ts` | 校验 `addTools` 候选与 fail-closed 工具边界；当前第三方 extension 候选明确降级拒绝 |
| `worker-manager.ts` | worker 生命周期、共享并发、回退、信号转发、请求恢复、聚合和 shutdown |
| `signal-log.ts` | append-only Signal Log 与 Worker Snapshot 投影 |
| `request-state.ts` | workerId/requestId 作用域的阻塞请求 deferred |
| `signal-tool.ts` | worker 专用 `dteam_signal` custom tool |
| `types.ts` | 0.8 worker、signal 与唯一工具参数类型 |

动态工具必须在首次 worker prompt 前完成候选注册和 active set 收窄。由于当前 Pi 公开 API 无法安全地只加载候选第三方 extension，0.8 先只开放 built-in 与 dteam 自定义工具候选，不全量发现或加载主会话 extension。
