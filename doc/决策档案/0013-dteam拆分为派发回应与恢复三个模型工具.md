# dteam 拆分为派发、回应与恢复三个模型工具

> **状态：✅ 已实施；ADR 0018 后增加 `dteam_wait` 成为四工具，ADR 0019 更新结果投影。**
>
> **更新**：推翻 ADR 0011 的“唯一模型工具名 `dteam`”决定；更新 ADR 0012 中通过 `dteam.respond` 执行 timeout recovery（超时恢复）的工具形态。保留 ADR 0008 的模型分级路由定位、ADR 0009 的会话级 Worker Manager（工作者管理器）和 ADR 0012 的主代理决策式逐级升级。

本 ADR 决定并已实施删除 `dteam({ type: "dispatch" | "respond" })`，拆出三个职责独立的模型工具；随后 ADR 0018 增加第四个 `dteam_wait`：

- `dteam_dispatch({ workers })`：原子受理 1–32 个互不依赖的后台 worker；不表达依赖、batch、dgoal task 对应关系或后续派发。
- `dteam_respond({ workerId, requestId, response })`：仅回应普通阻塞请求，包括提供上下文、授予本次派发预授权的工具、追加一次工具额度、作出业务决策或拒绝。
- `dteam_recover({ workerId, requestId, action })`：仅决定 timeout recovery，可选择 fresh retry、相邻 escalate、有限 extend 或 stop；仍由 Worker Manager 强制 fresh session、相邻升级、次数和预算上限。

`/dteam` 继续是用户查看、steering（插队指令）和确认取消的唯一入口；不新增 `dteam_status`、模型侧 cancel 或 steering。worker 的完成、失败和阻塞继续 follow-up（后续回传）给主模型，不引入轮询。`dteam_dispatch` 默认只显示紧凑受理摘要；按 `Ctrl+O` 展开完整但人类可读的详情，原始结构只保留在模型上下文与内部 details（ADR 0019）。

旧 `dteam` 工具不保留兼容转发或迁移报错层。该工具没有跨进程持久状态可迁移，兼容层会保留已废弃的宽 schema（模式）和运行时分支校验；升级说明与 CHANGELOG 将明确要求 `/reload`。
