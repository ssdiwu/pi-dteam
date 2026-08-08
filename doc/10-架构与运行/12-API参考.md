# dteam API 参考

> 当前模型侧注册五个工具：`dteam_dispatch`、`dteam_respond`、`dteam_control`、`dteam_recover`、`dteam_wait`；`/dteam` 仍是用户查看、steering（插队指令）与确认取消的管理命令。
>
> **实施状态**：派发、回应、运行中主动控制、恢复、显式等待、统一 WorkerReport、有限 handoff（交接）、可写中断守卫及人类可读结果投影已实现；自动化端到端与真实 Pi 多 worker 主动协调冒烟均已通过。主代理多轮路由见 [触发协议](./14-dteam触发协议.md)。

## 0. 必需配置

模型档位配置位于 `~/.pi/agent/pi-dteam.json`，T1/T2/T3 都必须是有序的 `provider/model[:thinking]` 候选数组。配置无效时 dteam 工具 fail-closed，不回落主会话模型。

## 1. `dteam_dispatch`

```ts
dteam_dispatch({
  workers: [{
    title: "读取配置",
    task: "核对配置文件格式，并提交结构化证据。",
    tier: "T3",
    handoff: {
      facts: [{ claim: "已有事实", evidence: "path:line", workerId: "前序-worker-id" }],
      constraints: ["只读"],
    },
  }],
})
```

- 原子受理 1–32 个相互独立且自包含的 worker；不表达 batch、依赖、Plan 或 goal/task 映射。
- T3→T2→T1 由主 LLM 决策；同档候选才自动回退。
- 所有档位默认只读。需要 `edit` 或 `write` 时，必须在 `addTools` 显式授权，并声明项目相对 `writeScope`。
- 可选 `handoff` 只传带 `workerId` 来源的事实、约束和不确定性；禁止主会话 / transcript（逐字记录） / P2P（点对点）消息。
- `writeScope` 是当前 worker 的局部预期写入范围，不是父任务的交付范围或完成条件。worker task 中已知的范围外未覆盖检查必须进入 `verification.remaining`，尚未查明且可能影响结论的风险进入 `uncertainties`。
- 默认只显示紧凑受理摘要；按 `Ctrl+O` 展开完整但仍为人类可读的 worker 列表，不显示原始 JSON（JavaScript 对象表示法）。

## 2. `dteam_respond`

```ts
dteam_respond({
  workerId: "...",
  requestId: "...",
  response: { type: "provide_context", context: "最小必要上下文" },
})
```

只回应普通阻塞请求：

- `provide_context`
- `grant_tools`（只能激活本次 `addTools` 预授权候选）
- `grant_tool_budget`（60–120，且为 10 的倍数；每个 worker 一次）
- `decision`
- `deny`
- `cancel`（带 `reason`；主代理决定自己接管该 worker 任务时用它直接停掉，不要 `deny` 后任其在后台空跑；不是通用 cancel 工具，只在 worker waiting 时可用。工具结果同步返回必要的 `writeInterrupted` 守卫，并清除该 worker 尚未消费的 parent event，详见 ADR 0023）

不能回应 timeout recovery（超时恢复）；该情形必须使用 `dteam_recover`。

## 3. `dteam_control`

```ts
dteam_control({
  workerId: "...",
  action: "steer",
  instruction: "依据 A 的发现，改走安全路径",
})
```

模型侧主动控制不依赖已有 `requestId`，只允许作用于 `running` worker。顶层只接受 `workerId`、`action`、`instruction`、`reason`；`steer` 需要 `instruction`，`graceful_stop` / `cancel` 可选 `reason`，其它字段 fail-closed：

- `steer`：向同一个 worker session（会话）追加有界纠偏或上下文指令；不改变工具权限、`writeScope` 或报告合同。
- `graceful_stop`：优先要求 worker 停止扩展并提交 `outcome="partial"` 的合法报告；重复请求 fail-closed。
- `cancel`：主代理认为任务已失去价值或优雅收敛未及时完成时强制取消，返回 `cancelInitiator="main"`；有 `writeScope` 时同步返回 `writeInterrupted`，并清除该 worker 的旧待回放事件。

`dteam_control` 不是 `dteam_respond` 的替代品：`dteam_respond({ response: { type: "cancel" } })` 仍只用于回应 `waiting` worker 的已有 request；timeout recovery 仍使用 `dteam_recover`。


## 4. `dteam_recover`

```ts
dteam_recover({ workerId: "...", requestId: "...", action: "retry" })
```

只回应 timeout recovery：

- `retry`：同档 fresh worker；
- `escalate`：只允许相邻的 T3→T2 或 T2→T1；
- `extend`：在累计恢复预算内延长；
- `stop`：终止为 `timed_out`；若有 `writeScope`，工具结果同步返回 `writeInterrupted` 守卫，并清除该 worker 尚未消费的 parent event。

Manager 强制 fresh session、相邻升级、次数与预算上限；不做 resume（恢复）。可写 worker 超时但尚未显式 stop 时，仍会回传首次 `write_interrupted`，主 LLM 必须先派 fresh T3 完整性检查，再决定修复或恢复。

## 5. `dteam_wait`

```ts
dteam_wait({
  workerIds: ["...", "..."],
  timeoutMs: 300_000,
})
```

仅当后续工作依赖指定 worker 的**下一可消费事件**时调用。`dteam_wait` 是事件消费，不是状态查询：调用时若已有匹配事件排队，会一次返回并删除全部匹配事件；否则任一目标 worker 产生 finding、request 或终态事件时立即返回。它不等待全部 worker 结束。

- `timeoutMs` 必须是 1–300000 的整数；timeout 只结束本次等待，不取消 worker、不触发 recovery。
- `events` 是本次实际消费的 `completed / failed / cancelled / finding / request / write_interrupted`，也是判断“本轮发生了什么”的事实来源。事件被 wait 捕获后立即从待回放队列删除，即使 wait 晚于事件发生也不会重复 follow-up；同一次迟到 wait 可以返回同一 worker 已排队的 finding 与 completed。
- `reason="worker_event"` 时，`ready` 只包含本次 `events` 涉及的 worker 快照；`reason="timeout"` 时，`ready` 包含当时已进入 `waiting` 或终态的目标 worker。`pendingWorkerIds` 只是本轮未进入 `ready` 的目标 ID，**不表示 worker 仍在运行，也不表示必须继续等待**；终态事件若已被前一次 wait 消费，该 worker 仍可能在后续 `worker_event` 结果的 `pendingWorkerIds` 中。主代理必须结合 `events`、`ready.state`、request 和真实后续依赖决定是否再次 wait，不能机械复制 pending 列表。
- 主代理通过 `dteam_respond(cancel)`、`dteam_control(cancel)` 或 `dteam_recover(stop)` 明确放弃 worker 时，该 worker 尚未消费的事件会原子清除；迟到 wait 不会把旧终态冒充成新事件。无 `writeScope` 且没有 assistant 文本和 `WorkerReport` 的失败仅供后续 wait 消费、不异步回放；其余未消费事件在主代理 idle / settled 后回放。可行动 finding 的展开详情显示 summary、evidence 与 impact；Signal Log 与 `/dteam` 仍保留记录。
- 进入 `waiting` 时先用 `dteam_respond` 或 `dteam_recover` 处理，再决定是否继续 wait，避免死锁。
- 默认显示目标 worker、已等待时长（`s`/`m+s`）与 timeout 上限，以及“本轮返回 / 本轮无事件”数量；执行中每秒刷新计时。`Ctrl+O` 再展开事件、worker、report、request 与本轮无事件列表。
- Pi 主会话 compaction（压缩）后，Manager 只会向下一次模型 context（上下文）一次性重注入内存中未收口 worker 的有界摘要：运行中/等待中/异常终态 worker，或 `partial`、有 `remaining` / `uncertainties` 的 completed worker。摘要包含局部 `writeScope`、验证与未收口风险；不保存 worker transcript（逐字记录）、不跨 reload（重载）恢复。

## 6. Worker 内部工具

`dteam_signal` 仍处理 progress、finding 和阻塞 request。每个 worker 结束前必须恰好调用一次统一的 `dteam_report`：

```ts
dteam_report({
  outcome: "completed", // completed | partial
  summary: "完成的简要结论",
  activities: ["inspected", "modified", "tested"],
  facts: [{ claim: "可核验结论", evidence: "文件:行号或测试命令" }],
  verification: {
    depth: "automated", // none | inspection | automated | runtime | visual
    status: "passed",   // passed | failed | partial | not_run
    evidence: ["npm test: 92 passed"],
    remaining: ["无浏览器环境，未做视觉复测"],
  },
  uncertainties: ["可选的未知事实"],
})
```

合同不变量：

- `outcome` 表达被派任务是否完成，不等于验证结果；Manager `state=completed` 也只表示 worker 正常结束并提交合法报告。
- `activities` 必须非空且不重复，只能使用 `inspected / modified / tested / executed / captured_visual`。
- `facts` 至少一项，每项 `claim / evidence` 非空；Manager 只为完成事件中的 facts 附加实际 `workerId` provenance（来源）。verification 不进入 handoff。
- `verification` 始终必填。未验证时必须是 `none + not_run + []`；其他深度必须有 evidence。inspection 要求 inspected，automated 要求 tested，runtime 要求 executed，visual 同时要求 executed 与 captured_visual。
- `remaining` 是已知但未完成的检查；`uncertainties` 是仍可能改变结论的未知。`human` 与 expected verification depth 不属于 WorkerReport。
- `writeScope` 或 task 的局部限制仅约束对应 worker。即使 `outcome=completed`，主代理也必须结合 workerBoundary（完成事件中的 Manager 派生局部范围）、`remaining` 与 `uncertainties` 决定父任务是否还需补验。
- `dteam_report` 是必需的最终报告，不消耗工作工具额度；旧 `{ summary, facts, uncertainties? }` 形状、未知字段或最终自由文本均 fail-closed。

## 7. 可写中断守卫

worker 因 failed、cancelled、shutdown、timed_out 或缺报告而未确认完成，且有 `writeScope` 时，Manager 回传包含 worker、reason 与 scope 的 `write_interrupted`。主代理显式 cancel/stop 时守卫随工具结果同步返回，且该 worker 旧 parent event 被清除；其他中断仍按事件渠道送达。主 LLM 不得将中断 worker 的结果当可信证据，必须派 fresh T3 检查 scope 的 diff、编译或定向测试。

reload（重载）或新会话前，若工作区存在未解释的 dirty diff（未提交差异），主 LLM 也必须先作 T3 完整性检查，才能再派可写 worker。守卫不自动回滚、不创建持久标记、不自动派发检查 worker。

## 8. Worker 用量账本

worker session 仍使用 `SessionManager.inMemory()`，不会写入 Pi session JSONL。每条 worker assistant message 的纯数字 usage / cost 追加到：

```text
~/.pi/agent/dteam-usage.jsonl
```

记录包含 v1、时间、父会话、项目、worker、请求/实际档位、candidate、模型、usage 与 `dedupKey`；不包含 task、prompt、输出、工具参数或 WorkerReport。失败、超时、fallback 与恢复 attempt 的实际模型回复同样计入。账本写入失败不改变 worker 业务状态；`pi-session-insights` 作为独立只读消费者聚合展示。

## 9. 工具结果投影与不提供

所有用户可见工具默认显示紧凑摘要；`Ctrl+O` 展开完整但仍为人类可读的文字、列表和诊断。完成 worker 的展开详情显示 outcome、activities、verification、facts、remaining 与 uncertainties，不显示原始 JSON。完整结构只保留在模型上下文、内部 `details` 与测试。
完成事件与 `dteam_wait` 的 ready Snapshot 还会显示 Manager 派生的 workerBoundary：`writeScope` 仅代表该 worker 的局部范围，不能被当作父任务已覆盖的工件清单。

不提供：

- 旧 `dteam({ type })`，无兼容层；升级后执行 `/reload`。
- `dteam_status`、通用轮询以及旧的“模型侧不提供 steer/cancel”限制不再存在：主代理经 `dteam_control` 控制 `running` worker；用户管理仍经 `/dteam`。`dteam_respond` 的 `cancel` 仍是受限响应（只在 worker waiting 时可用，ADR 0023），不是 `dteam_control` 的替代品。`dteam_wait` 是显式事件等待，不是状态查询或轮询。
- batch、依赖图、自动升级、Orchestrator Loop、TTL Signal Store、P2P、resume、worktree 或文件锁。
