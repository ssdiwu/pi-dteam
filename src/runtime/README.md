# runtime/

0.8 的会话级后台运行时。这里仅管理当前 Pi 会话内已提交 worker 的生命周期、signal、候选工具和回传；不保存 batch、依赖图、dgoal 状态或跨 reload 恢复数据。每次 attempt 默认五分钟，timeout recovery 独立累计上限十分钟；同档候选自动尝试，跨档仅由主代理经 `respond` 相邻升级。工作工具额度按初始档位为 T3=60、T2=120、T1=180；worker 可申请一次由主代理批准的 +60～+120（10 的倍数），再次耗尽由主代理重新 dispatch fresh worker。实时文本、thinking、工具活动和 timeout 诊断投影到 Worker Snapshot，供 `/dteam` 消费。

| 文件 | 职责 |
|---|---|
| `tool-policy.ts` | 校验 `addTools` 候选与 fail-closed 工具边界；当前第三方 extension 候选明确降级拒绝 |
| `worker-manager.ts` | worker 生命周期、共享并发、同档候选、timeout recovery、信号转发、聚合和 shutdown |
| `signal-log.ts` | append-only Signal Log 与 Worker Snapshot 投影 |
| `request-state.ts` | workerId/requestId 作用域的阻塞请求 deferred |
| `signal-tool.ts` | worker 专用 `dteam_signal` custom tool |
| `types.ts` | 0.8 worker、signal 与唯一工具参数类型 |

动态工具必须在首次 worker prompt 前完成候选注册和 active set 收窄。由于当前 Pi 公开 API 无法安全地只加载候选第三方 extension，0.8 先只开放 built-in 与 dteam 自定义工具候选，不全量发现或加载主会话 extension。
