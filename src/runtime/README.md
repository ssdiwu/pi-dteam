# runtime/

0.8 的会话级后台运行时。这里仅管理当前 Pi 会话内已提交 worker 的生命周期、signal、候选工具和回传；主代理的多轮证据路由留在对话层，不保存轮次、batch、依赖图、外部地图、dgoal 状态或跨 reload 恢复数据。每次 attempt 默认五分钟，timeout recovery 独立累计上限十分钟；同档候选自动尝试，跨档仅由主代理经 `dteam_recover` 相邻升级。工作工具额度按初始档位为 T3=60、T2=120、T1=180，`dteam_signal` 与最终 `dteam_report` 不计入；worker 可申请一次由主代理批准的 +60～+120（10 的倍数），再次耗尽由主代理重新 dispatch fresh worker。实时文本、thinking、工具活动和 timeout 诊断投影到 Worker Snapshot，供 `/dteam` 消费。parent event 先进入待消费队列；wait 已消费的事件不会再 follow-up；无 writeScope 且没有 assistant 文本和 WorkerReport 的失败仅供后续 wait 消费，不回放到主对话。每条 worker assistant message 的纯数字 usage 另写独立账本，不持久化 worker 正文。

| 文件 | 职责 |
|---|---|
| `tool-policy.ts` | 校验 `addTools` 候选与 fail-closed 工具边界；当前第三方 extension 候选明确降级拒绝 |
| `worker-manager.ts` | worker 生命周期、共享并发、同档候选、timeout recovery、信号转发、单次事件消费，以及集中 attempt 启动、恢复重置和 AgentSession 释放 |
| `signal-log.ts` | append-only Signal Log 与 Worker Snapshot 投影 |
| `request-state.ts` | workerId/requestId 作用域的阻塞请求 deferred |
| `signal-tool.ts` | worker 专用 `dteam_signal` custom tool |
| `report-tool.ts` | `dteam_report` 的唯一 schema / parser；验证 outcome、activities、facts 与 verification |
| `sanitize.ts` | 脱敏、递归边界和字符串截断；供运行时与入口事件序列化共用 |
| `usage-ledger.ts` | `~/.pi/agent/dteam-usage.jsonl` 的纯数字白名单、去重键与 `0600` append-only 写入 |
| `types.ts` | 0.8 四工具、worker、统一 WorkerReport、signal、handoff 与 wait 类型 |

worker 只有提交合法 WorkerReport 才能进入 Manager `completed`；同档 candidate 的报告带 attempt token，候选切换后旧 token 与报告立即失效。该状态不承诺 `outcome=completed` 或 verification passed。完成事件只为 facts 附加真实 workerId provenance，verification 不进入 handoff。

动态工具必须在首次 worker prompt 前完成候选注册和 active set 收窄。由于当前 Pi 公开 API 无法安全地只加载候选第三方 extension，0.8 先只开放 built-in 与 dteam 自定义工具候选，不全量发现或加载主会话 extension；外部来源由主代理选取并本地化后再交 T3 提取。
