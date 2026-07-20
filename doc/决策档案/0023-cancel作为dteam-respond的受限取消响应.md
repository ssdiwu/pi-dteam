# cancel 作为 dteam_respond 的受限取消响应

> **状态：✅ 已实施；修订 ADR 0013 中"不做模型侧 cancel"的表述。**
>
> **更新**：在 ADR 0013 的 `dteam_respond`（普通回应工具）响应类型里增加 `cancel`，作为 `deny`（拒绝）的并列选项。它不是通用 cancel（取消）工具，只在 worker 处于 waiting（发了非 timeout_recovery request）时可用。
>
> **修订**：0.9.0 落地后仍出现"主代理已知 cancel 终态却在 idle/settled 后迟到回放"的缺口。现约定：经 `dteam_respond(cancel)` 触发的 `cancelled` / `write_interrupted` 改为 `wait_only`（仅显式等待可消费），并把写入守卫同步返回给 respond 结果；经 `/dteam` 的用户取消仍保持 `follow_up`，因主代理未必知情。

## 背景

ADR 0013 决定"`/dteam` 是确认取消的唯一入口；不新增模型侧 cancel"。这否决的是**通用** cancel 工具——主代理可凭空停掉任意 running（运行中）worker。

但它留下一个缺口：主代理用 `dteam_respond` 的 `deny` 拒绝一个 worker 的核心能力请求（例如可写 worker 申请写工具）后，worker 拿到 deny 作为工具结果会继续在后台运行，直到自己 `dteam_report`（结构化报告）完成。这段"deny 后仍在后台空跑"的时间里，主代理往往已经决定自己接管任务；而 worker 最终完成时，其回执按现有事件机制（术语表 `dteam_wait` 条目）会等到主代理 idle（空闲）/ settled（轮次安定）才异步回放，正好撞在主代理已经收口、向用户汇报"完成"之后，表现为"任务都结束了才冒出来一个 worker"。

主代理在 worker 请求交互的那一刻（worker 处于 waiting），本就有决策权：grant（授予）、deny 或……在本次之前缺少"直接停掉它"的选项。

## 决策

在 `dteam_respond` 的 `response.type` 里增加 `cancel`，与 `deny` 并列，带 `reason`：

- `cancel` 允许回应所有**非 timeout_recovery** 的 request kind（`request_context` / `request_tools` / `request_tool_budget` / `request_decision` / `blocked`）；timeout recovery（超时恢复）仍走 `dteam_recover` 的 `stop`。
- 主代理对一个 waiting worker 发出 `cancel` 后，Worker Manager（工作者管理器）先把该 request 回应为 `cancel`（让 worker 的 signal 调用拿到 cancel 结果），再立即终止该 worker（`cancelled`，中止 session、释放并发槽）。因主代理已通过工具返回值同步知道结果，由此路径发出的 `cancelled` / `write_interrupted` parent event 使用 `wait_only`（不 idle 回放）；若 worker 有 `writeScope`，写入守卫同步出现在 respond 返回值中，主代理仍可用 `dteam_wait` 显式取回事件。
- 这是**接管协议**的落地：主代理决定自己接管一个 worker 的任务时，用 `cancel` 停掉它，不要 `deny` 后任其在后台空跑。配套在 worker 系统提示里要求：发现缺少核心能力时立即 `dteam_signal(kind="blocked")` 报告并等待主代理决策，不在能力缺失时空转。

## 为什么不违背 0013"不做模型侧 cancel"

0013 否决的是通用 cancel——主代理凭空停掉一个 running worker。本 ADR 的 `cancel` 是**受限**的：

1. 它**不是一个新工具**，而是 `dteam_respond` 的一个响应类型，只能用于回应 worker 已经发出的某个 request。
2. 因此它只在 worker 处于 waiting（主动请求交互）时可用；主代理**不能**用它停掉一个 running 的 worker。
3. 它的触发点恰好是主代理该做"给 / 不给 / 停掉"决策的时刻，与 `deny` 同位，是 `deny`（不给工具、继续）的自然延伸为（不给工具、停止）。

换言之，它给主代理补上的是"在 worker 请求交互时直接终止它"的能力，不是"随时停掉任意后台 worker"的通用能力。后者仍由 `/dteam` 独占（ADR 0013）。

## 不做的边界

- **不做通用 cancel 工具**：running worker 不能凭空停（仍走 `/dteam`）；要等它下次请求交互，或走 timeout recovery 的 `stop`。
- **不做 `dteam_status` / 主动查看**：主代理"随时查看后台 worker 状态/产物"的能力（含限频）是单独的方案一，需另行论证是否推翻 0013/0018 的轮询否决，不在本 ADR 范围。
- **区分 cancel 来源的事件投递**：`dteam_respond(cancel)` 是主代理已知动作，终态与写入守卫不走 idle follow-up；`/dteam` 用户取消仍 follow-up，因主代理未必在场。不把 `write_interrupted` 静默掉——可写 worker 在请求前可能已写过文件，守卫必须保留。
