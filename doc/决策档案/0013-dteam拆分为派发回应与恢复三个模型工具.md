# dteam 拆分为派发、回应与恢复三个模型工具

> **状态：✅ 已实施；ADR 0018 后增加 `dteam_wait`，ADR 0024 再增加 `dteam_control` 成为第五个模型工具并取代“模型侧不提供通用 steering”的限制，ADR 0019 更新结果投影。**
>
> **更新**：推翻 ADR 0011 的“唯一模型工具名 `dteam`”决定；更新 ADR 0012 中通过 `dteam.respond` 执行 timeout recovery（超时恢复）的工具形态。保留 ADR 0008 的模型分级路由定位、ADR 0009 的会话级 Worker Manager（工作者管理器）和 ADR 0012 的主代理决策式逐级升级。

本 ADR 决定并已实施删除 `dteam({ type: "dispatch" | "respond" })`，拆出三个职责独立的模型工具；随后 ADR 0018 增加第四个 `dteam_wait`，ADR 0024 增加第五个 `dteam_control`：

- `dteam_dispatch({ workers })`：原子受理 1–32 个互不依赖的后台 worker；不表达依赖、batch、dgoal task 对应关系或后续派发。
- `dteam_respond({ workerId, requestId, response })`：仅回应普通阻塞请求，包括提供上下文、授予本次派发预授权的工具、追加一次工具额度、作出业务决策或拒绝。
- `dteam_recover({ workerId, requestId, action })`：仅决定 timeout recovery，可选择 fresh retry、相邻 escalate、有限 extend 或 stop；仍由 Worker Manager 强制 fresh session、相邻升级、次数和预算上限。

`/dteam` 继续是用户查看、steering（插队指令）和确认取消的入口；`dteam_control` 现在允许主代理对 `running` worker 执行有界 `steer`、`graceful_stop` 或 `cancel`，不授予工具、不扩大 `writeScope`。`dteam_respond` 的 `cancel` 仍只在 worker `waiting` 时用于回应已有 request；不新增 `dteam_status` 或轮询。worker 的完成、失败、finding 和阻塞继续经事件机制回传主模型，不引入轮询。`dteam_dispatch` 默认只显示紧凑受理摘要；按 `Ctrl+O` 展开完整但人类可读的详情，原始结构只保留在模型上下文与内部 details（ADR 0019）。

旧 `dteam` 工具不保留兼容转发或迁移报错层。该工具没有跨进程持久状态可迁移，兼容层会保留已废弃的宽 schema（模式）和运行时分支校验；升级说明与 CHANGELOG 将明确要求 `/reload`。
