# dteam 重构为会话级后台运行时与星型信号协议

> **状态：✅ 有效，0.8 已实施**
>
> **推翻 / 更新范围**：更新 ADR 0008 中“同步返回、无运行态 UI、无后台返回”的旧实现形态；保留其 dteam = 模型分级路由、T1/T2/T3、fresh 隔离、单公开工具、回退与不做 workflow 的定位。
>
> **不复活**：ADR 0005 的 Orchestrator Loop、Signal Store TTL、五角色、信号驱动的下一轮召唤；ADR 0003 的“依附 Extension Runtime 的长期后台 run”；ADR 0004 的 resume 禁令继续有效。

## 1. 决定

将 dteam 从 0.7“每次 `dteam_dispatch` 同步等待结果”的执行形态，重构为：

> **会话级 Worker Manager（工作者管理器）管理后台 `AgentSession` worker，以双向、有类型的 star topology（星型拓扑）signal 协作；主代理仍是唯一的路由、判断与汇总 owner。**

`/dteam` 是唯一管理入口，提供列表和单次会话式详情；0.8 的 `dteam` 是唯一公开模型工具，立即返回接收凭据而非 worker 最终结果。

## 2. 为什么现在要改

0.7 已解决“强模型不该做小任务”的模型分级问题，但同步 tool call（工具调用）把主代理锁在等待中：

- 无法继续推进主对话；
- 无法看到运行中 worker 的过程事实；
- worker 发现上下文缺失、工具不足、决策歧义时只能自行猜测或失败；
- 用户无法安全地接管运行中任务。

这些是后台单任务执行的真实摩擦，不需要重新发明“谁该被召唤、下一步是什么”的编排系统。故把新增复杂度限定为 worker 生命周期、明确请求和可观察性。

## 3. 保留什么、改变什么

| 保留 | 改变 |
|---|---|
| dteam 的本质是 T1/T2/T3 模型分级路由 | worker 由同步等待改为会话级后台运行 |
| 主代理负责任务拆分、tier、验收、综合 | Worker Manager 只管理已派发单任务，不做决策循环 |
| 单公开模型工具 `dteam` | 以 dispatch/respond 辨别式参数受理 worker，结果先返回 `DispatchAccepted`，完成后 follow-up 回传 |
| fresh `AgentSession` + Logical Isolation | 原 session 在等待请求时保留，用 `RequestState` deferred result 恢复 |
| fallback、并发、多供应商路由 | 增加 Worker Snapshot、Signal Log、Request State |
| 不做 resume | Pi 会话退出/重载即中止活跃 worker；无跨进程恢复 |

## 4. 信号协议与职责

采用 **worker → Manager → 主代理 → Manager → worker** 的星型拓扑：

- A 类系统 signal：Worker Manager 写入状态迁移事实；
- B 类 worker signal：`progress`、`finding`、`request_context`、`request_tools`、`request_decision`、`blocked`；
- C 类 parent signal：`provide_context`、`grant_tools`、`deny`、`decision`、`cancel`。

worker 不能互发消息，不能决定下一轮派发，更不能直接升级自身权限。非阻塞过程信号只更新 UI；阻塞请求通过结构化 parent event 请主代理回答，并用 `Request State` deferred result 暂停并恢复原 worker。follow-up 仅用于主代理通知，不负责解锁 worker。

完成成功结果允许 500ms–1s 短窗合并；失败、取消、`user_cancelled`、阻塞请求必须立即单条回传。

## 5. 工具权限的硬边界

Pi 已公开 `AgentSession.setActiveToolsByName()`，可在下一个 agent turn 切换**已经注册**的工具；未知工具会被静默忽略，且没有公开的“向既有 session 注册新第三方工具”API。

因此定为：

1. 主代理在派发时显式传 `addTools`，它是该 worker 的预授权候选上限；不能传抽象能力名或 dteam 自行推测的工具。
2. worker 仅能用 `request_tools` 请求候选集内工具；Manager 验证后才激活，并通过 `RequestState` deferred result 恢复原 session。
3. 候选外工具明确拒绝（fail-closed），不得依赖 Pi 的“未知名静默忽略”。
4. 0.8 不以“加载所有 extension 再假装没授权”为代价换取任意晚授权；第三方候选 extension 的最小安全加载方式必须先经实现切片验证。

这样“动态追加”指同一 session 的动态**激活**，而不是无边界地动态加载任意未知工具。

## 6. 被明确拒绝的替代方案

| 方案 | 拒绝原因 |
|---|---|
| 重建 Orchestrator Loop，由 dteam 自己决定下一 worker | 又回到 0005 的重型机制，主代理已有任务上下文和判断责任 |
| Signal Store + TTL / 分数衰减 | 过程事实不应被衰减推理；0.8 只需要日志、快照与等待请求 |
| worker P2P mailbox / swarm list | 让协作拓扑和所有权失控；主代理中转足够 |
| 多个 `status` / `grant` / `cancel` 对外工具 | 破坏单工具哲学；管理通过 `/dteam` 与主代理 follow-up 完成 |
| 任意运行时扫描、加载并授权外部工具 | Pi 对原 session 没有公开注册 API；会形成隐式权限升级和 extension 加载副作用 |
| 常驻悬浮面板 | 历史查看频率低，状态栏 + 按需 `/dteam` Modal 更轻 |

## 7. 后果与代价

- **得到**：主代理不再被小任务阻塞；worker 能请求最小上下文、决策或预授权工具；用户可观察并在运行中 steering；结果不丢失在工具调用结束后。
- **付出**：需要维护内存运行态、取消确认、follow-up 节流与 TUI；会话关闭会中止活跃工作，不提供恢复。
- **风险控制**：先完成 Pi 动态 active-tools（激活工具）最小验证，再实现 Manager；所有状态转移和协议 schema 先有单元测试，真实 provider 冒烟最后做。

## 8. 关联

- 实施蓝图：[15-dteam会话级后台运行时与信号协议.md](../10-架构与运行/15-dteam会话级后台运行时与信号协议.md)
- 路线图：[32-v0.8-会话级后台运行时切片.md](../30-路线图/32-v0.8-会话级后台运行时切片.md)
- 保留的定位权威：[ADR 0008](./0008-dteam重定位为模型分级路由执行层.md)
- 保留的“不做 resume”：[ADR 0004](./0004-不做resume和默认持久化.md)
