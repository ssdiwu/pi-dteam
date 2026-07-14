# dteam 会话级后台运行时与信号协议（0.8 目标）

> **状态：✅ 已实现（0.8）。** 本文是会话级后台运行时与信号协议的实现蓝图；当前唯一模型工具为 `dteam`。
>
> 目标不是复活 Orchestrator Loop（编排循环）或 Signal Store（信号存储），而是让主代理可以把**一个或多个已明确档位、已由它判断现在应派的 worker 请求**交给后台 dteam，继续主对话，并在需要时用有类型的双向 signal（信号）协作。一次调用的多 worker 列表只是派发参数，不引入 dteam batch（批次）运行态。
>
> 决策权威见 [ADR 0009](../决策档案/0009-dteam重构为会话级后台运行时与星型信号协议.md)。

## 1. 0.8 解决的问题与边界

0.7 的同步工具要等 worker 完成才返回；主代理无法在 worker 运行时纠偏、补上下文、授权工具，也无法在一个入口内回看运行历史。0.8 已改为会话级后台运行时：`dteam` 派发立即返回接收凭据，完成结果再汇聚回主对话。

**仍然是 dteam 的边界：**

- dteam = T1/T2/T3 模型分级路由 + 后台 worker 执行器；一次派发可含多项独立请求，但不维护 task plan、batch 或依赖图。
- worker 之间不直接通信；主代理是唯一 owner（所有协作经它中转）。
- 不做 resume（恢复）：Pi 会话结束、扩展重载或宿主退出时，运行中 worker 一律中止；仅可保留已结束的只读记录。
- 不复活旧 Orchestrator Loop、Signal Store TTL（过期衰减）、五角色、竞争认领或 P2P mailbox（点对点邮箱）。
- 不预置任何个人网页工具名或抽象能力标签。每次派发由主代理传入当前会话确实可授权的精确工具名。

## 2. 总体结构

```text
主代理 / Pi 主会话
  │ dteam(一个或多个已就绪的 worker 请求)
  ▼
Worker Manager（本 Pi 会话内，唯一运行态 owner）
  ├─ Worker Record + AgentSession + AbortController
  ├─ Signal Log（只追加）
  ├─ Worker Snapshot（当前展示态）
  ├─ Request State（等待主代理答复的阻塞请求）
  ├─ completion aggregation（成功结果短窗汇聚）
  └─ /dteam Modal + 仅运行中显示的 status
  │
  ├─ fresh worker 1: T3 / T2 / T1 AgentSession
  ├─ fresh worker 2: ...
  └─ fresh worker n: ...

worker ──B 类 signal──► Worker Manager ──结构化 parent event──► 主代理
worker ◄─C 类 signal─── Worker Manager ◄─主代理决策
```

`Worker Manager` 是状态所有者，不是决定“下一步该派谁”的编排者：它只执行主代理已提交的独立 worker 请求、保存过程事实、转发请求、处理取消、汇聚完成事件。它不保存这些请求所属的批次，不理解 worker 间依赖，也不会因 A/B 完成自动释放 C。

## 3. 生命周期与状态

### 3.1 Worker Record

每个派发创建一个内存 `WorkerRecord`：

```ts
interface WorkerRecord {
  id: string
  title: string
  task: string
  requestedTier: Tier
  activeTier: Tier
  fallbackTrail: Attempt[] // 同档候选与主代理明确的相邻升级轨迹
  state: "queued" | "running" | "waiting" | "completed" | "failed" | "timed_out" | "cancelled" | "shutdown"
  session: AgentSession
  controller: AbortController
  baseTools: string[]
  eligibleTools: string[]
  activeTools: string[]
  toolCallCount: number
  toolCallBudget: number
  toolBudgetExtensionCount: number
  startedAt?: number
  endedAt?: number
  result?: WorkerResult
  error?: WorkerError
}
```

`waiting` 只表示 worker 发出了需要主代理回答的 request（请求），其原 `AgentSession` 仍保留；`completed` / `failed` / `cancelled` 后封存为只读历史，不能 steering（插队指令）、补上下文或再授权。

取消流程是 `running` / `waiting` → **确认** → `cancelled`；session shutdown 进入独立 `shutdown`。worker 达到总预算时先建立 timeout recovery request 并等待主代理的 retry / escalate / extend / stop；只有 stop 或恢复上限耗尽后才进入 `timed_out`。它们不与 `failed` 合并；用户取消必须产生 `reason: "user_cancelled"`。

### 3.2 三份状态而非旧 Signal Store

| 工件 | 内容 | 生命周期 | 用途 |
|---|---|---|---|
| **Signal Log** | 按序追加的已验证 signal 事实 | 当前 Pi 会话 | 审计、详情页过程时间线 |
| **Worker Snapshot** | 每个 worker 的最新 state、进度、标题、档位、耗时、最新 finding | 当前 Pi 会话 | 列表、状态栏、快速渲染 |
| **Request State** | 待答复 request 的 ID、来源 worker、kind、payload、`Promise` resolver | 请求完成或 worker 结束即清理 | 使 `request_*` 真正暂停并等待主代理 |

三者都不做 TTL、权重衰减或“信号推导下一轮任务”。`Signal Log` 是可观察性日志，不是旧 `Signal Store`。

### 3.3 会话终止

- Extension shutdown（扩展关闭）/ Pi process exit（进程退出）/ reload（重载）：Manager abort（中止）所有 `queued`、`running`、`waiting` worker，并将活跃内存态清空；不重启、不恢复。
- 结束记录可在同一宿主会话中供 `/dteam` 回看；跨进程持久化与 resume 不在 0.8 范围。

## 4. 唯一公开工具与回传

0.8 只有 `dteam` 这一个模型工具；`/dteam` 是用户管理命令。用 `type`（类型）区分两种模型动作——文档中可简称 `dteam.dispatch` / `dteam.respond`，但 Pi 实际只注册一个名为 `dteam` 的工具。

```ts
// dteam.dispatch：主代理已经判断这些 worker 现在可启动
dteam({
  type: "dispatch",
  workers: [{
    title: string,
    task: string,
    tier: "T1" | "T2" | "T3",
    addTools?: string[],
  }], // 1–32 项
})

// dteam.respond：答复一个处于 waiting 的 worker request
dteam({
  type: "respond",
  workerId: string,
  requestId: string,
  response:
    | { type: "provide_context", context: string }
    | { type: "grant_tools", tools: string[] }
    | { type: "grant_tool_budget", additionalCalls: number }
    | { type: "decision", decision: string }
    | { type: "retry" }
    | { type: "escalate", tier: "T2" | "T1" }
    | { type: "extend", additionalMs: number }
    | { type: "stop", reason?: string }
    | { type: "deny", reason: string },
})
```

- `tier` 绝不由 dteam 猜测。初始注册权限 = 该 worker 的 tier 默认基础工具 ∪ 已核验的 `addTools` ∪ `dteam_signal`，但首次 prompt 激活集只含基础工具与 signal；T3 仍默认本地只读。
- `addTools` 不接受 `web`、`browser` 等能力标签；工具名不可用、重复或越过当前会话授予清单时，一律 fail-closed（失败即关闭）。`grant_tools` 只能激活该 worker 的 `addTools` 候选。
- `dispatch` 返回每项各自的 `DispatchAccepted { workerId, title, tier, state: "queued" }`，不得等待任一 worker 完成；不存在 `batchId`、batch 接收凭据或 batch 完成态。
- `respond` 只接受仍处于 waiting 的匹配 `workerId + requestId`，且 C 类 response 必须匹配对应 B 类 request；先完成 C 类 signal（父级信号）状态变更，再兑现原 `dteam_signal` 阻塞工具的 deferred result（`grant_tools` 先更新 active tools）。`grant_tool_budget` 仅能批准一次 +60～+120 次（10 的倍数）；worker 再次耗尽时结束并回传诊断，由主代理重新 dispatch fresh worker。`retry` / `escalate` / `extend` 是 timeout recovery 的特例：它们创建一个新的 fresh `AgentSession` 并注入裁剪恢复摘要，而不是恢复原 session；其他 response 也通过 `RequestState` deferred result 恢复原 session，主代理通知可用 follow-up 传递，但不负责解锁 worker。
- 用户取消不走模型 `respond`：只能从 `/dteam` 的二次确认或 session shutdown（会话关闭）触发内部 `cancel`，避免模型无确认中止用户的后台工作。
- 一次调用列出的 worker 不表示依赖、共同归属某个 dgoal task，或完成后自动继续下一组；主代理已独立判断这些请求目前可启动。

### 4.1 主对话回传节流

| 事件 | 回传方式 |
|---|---|
| `completed` | 500ms–1s 的短窗口合并多个成功结果，以一条 follow-up（后续消息）交给主代理 |
| `failed` | 立即单条 follow-up |
| `cancelled` | 立即单条 follow-up；用户取消固定携带 `reason: "user_cancelled"` |
| `request_context` / `request_tools` / `request_decision` / `blocked` / `timeout_recovery` | 立即 follow-up，请主代理明确回应 |
| `progress` / `finding` | 只更新 Snapshot、时间线和 `/dteam`；不为每条过程信号打断主对话 |

汇聚窗口只合并成功结果；不能吞掉失败、取消、阻塞或请求。

## 5. 有类型星型 signal 协议

所有消息都带 `signalId`、`workerId`、`at`、`kind`、结构化 `payload`。Worker Manager 校验发件人、状态与 schema（模式）后才写入 Signal Log。

### A 类：系统 signal（Manager 产生）

`worker_queued`、`worker_started`、`worker_waiting`、`worker_timeout_requested`、`worker_completed`、`worker_failed`、`worker_timed_out`、`worker_cancelled`、`attempt_started`、`attempt_completed`。

它们是状态迁移的事实来源；worker 不得伪造。

### B 类：worker → parent signal

| kind | 是否阻塞 worker | payload 核心 |
|---|---:|---|
| `progress` | 否 | `message`、可选 `percent` |
| `finding` | 否 | `summary`、可选 `evidence` |
| `request_context` | 是 | `requestId`、`question`、需要的最小上下文 |
| `request_tools` | 是 | `requestId`、`tools`、`reason` |
| `request_tool_budget` | 是 | `requestId`、`reason`；Manager 回传实际已用次数、额度和追加次数 |
| `request_decision` | 是 | `requestId`、`question`、可选候选与推荐 |
| `blocked` | 是 | `requestId`、`reason`、可选可行动作 |

非阻塞 B 类 signal 的 custom tool（自定义工具）立即返回；阻塞 B 类 signal 在 `Request State` 建立 deferred（延迟承诺），等待 C 类回应、取消或超时后才结束该工具调用，因此 worker 不会猜测答案继续跑。工作工具初始额度按档位为 T3=60、T2=120、T1=180，`dteam_signal` 本身不计入；worker 必须在耗尽前提出 `request_tool_budget`，而不是直接继续无界调用。

### C 类：parent → worker signal

| kind | 对应 B 类 | 行为 |
|---|---|---|
| `provide_context` | `request_context` | 通过 `RequestState` deferred result 返回上下文，恢复该 worker |
| `grant_tools` | `request_tools` | 更新 active tool set，再通过 `RequestState` deferred result 返回授权边界 |
| `grant_tool_budget` | `request_tool_budget` | 只接受 +60～+120 次（10 的倍数），每 worker 最多一次；增加当前额度后恢复原 session |
| `deny` | 任意 request | 通过 `RequestState` deferred result 返回明确原因，worker 可改方案或 `blocked` |
| `decision` | `request_decision` / `blocked` | 通过 `RequestState` deferred result 传入主代理判断，恢复 worker |
| `retry` | `timeout_recovery` | 创建同档 fresh attempt，并注入裁剪恢复摘要 |
| `escalate` | `timeout_recovery` | 只允许 T3→T2 或 T2→T1 的 fresh attempt |
| `extend` | `timeout_recovery` | 在次数和总预算上限内延长当前 worker 预算 |
| `stop` | `timeout_recovery` | 写入 `timed_out` 终态与诊断 |
| `cancel` | 任意运行态 | abort worker；只由已确认的取消流程发送 |

C 类以唯一公开 `dteam` 工具的结构化 `respond` 参数表达；Manager 对 request kind 与 response schema fail-closed 校验后调用内部 API。`/dteam` 只提供用户 steering 和确认取消，不解析自然语言恢复动作。worker 永远不直接调用另一个 worker。

## 6. 原 AgentSession 的动态工具注入：已验证的约束

Pi `AgentSession`（已在本机 Pi 0.80.6 核验）提供：

- `getAllTools()` / `getToolDefinition(name)`：查看该 session 已注册的工具；
- `getActiveToolNames()`：查看当前激活集；
- `setActiveToolsByName(names)`：替换 active tool set，并在**下一 agent turn（代理轮次）**生效；
- `session.followUp()` / `session.steer()`：在原 session 继续或插入指令。

本机最小验证创建了带 `read` 和一个 custom tool 的 session：`setActiveToolsByName(["read"])` 成功撤销 custom tool；再次传入 custom tool 名成功恢复；未知名未进入 active 集。

但它**不能注册新工具定义**：未知名会被 Pi 静默忽略。并且 SDK `createAgentSession({ tools })` 的 `tools` 是 allowlist（允许清单）且初始全部激活；session reload 还会重新激活 allowlist 内全部工具。因此 0.8 采用以下约束：

1. Worker 创建时必须已注册 `baseTools ∪ addTools ∪ dteam_signal`，随后立即把 active 集收窄到 `baseTools ∪ dteam_signal`；首次 prompt 之前完成此收窄。
2. `request_tools` **只能请求本次派发的 `addTools` 候选集**；Manager 校验后才调用 `setActiveToolsByName([...activeTools, ...granted])`，再兑现原 signal 工具调用恢复原 session。
3. 未随派发注册的任意工具不能在原 session 后加；Manager 必须 `deny`，不允许“扫描当前工具宇宙”或把未知名交给 Pi 静默忽略。
4. 动态权限期内不调用 `session.reload()`；若未来必须重载，先保存 `activeTools`，重载后立刻重放该集合，并补自动化测试。
5. `addTools` 是**本 worker 的预授权候选上限**，不是 dteam 的全局工具目录，更不是自动可用的网页能力。当前主会话 active tools 在每次 dispatch 校验时重新读取；附加工具默认只注册不激活，经 `request_tools` 再激活。

这保留了“主代理显式授予、worker 申请、原 session 继续”的体验，同时不假装 Pi 支持任意晚注册第三方工具。实施切片 1 必须验证如何仅加载候选工具所属的 extension（扩展）而不重新执行无关 extension；若 Pi 的公开 API 做不到，0.8 只支持 built-in（内置）和 dteam custom 候选工具，第三方候选工具留到有安全加载方案后再开放。

## 7. `/dteam` Modal（弹窗）与接管

`/dteam` 是唯一管理命令；不另设 `/subagents`。

- **列表默认页**：运行中与历史合并，运行中置顶；一行优先显示 `title`、当前工具、裁剪实时输出、档位轨迹、耗时和状态。
- **详情页**：选择 worker 后进入同一会话式详情，显示有界 Signal Log 事实、权限、实时文本、思考片段、当前工具、timeout 诊断、结果或错误。运行中直接进入 Takeover View（接管视图）。
- **运行中接管**：允许 steering；取消必须二次确认；等待请求时提供“将决策交给主代理”的状态而非让用户代替主代理做路由。
- **结束后封存**：`completed` / `failed` / `cancelled` 详情只读。
- **布局**：借 dgoal 的 `ui.custom({ overlay: true, maxHeight: "85%" })`；标题钉顶、正文滚动，复用 `j/k`、方向键、`Esc` 的滚动/关闭策略。不做常驻浮窗。
- **status（状态栏）**：只有至少一个 `queued` / `running` / `waiting` worker 时显示摘要；没有活跃 worker 时完全隐藏，历史只由 `/dteam` 查看。

## 8. 需要落到代码的模块边界

```text
src/runtime/worker-manager.ts   WorkerRecord 生命周期、共享并发、取消、回传汇聚
src/runtime/signal-log.ts       append-only Signal Log + Snapshot 投影
src/runtime/request-state.ts    deferred request 与 C 类回应
src/runtime/tool-policy.ts     tier session 候选工具注册与动态 active set 校验
src/session.ts                 tier session 创建、候选注册与首次 active set 收窄
src/runtime/signal-tool.ts      worker 专用 dteam_signal custom tool
index.ts                       主会话 follow-up 回传与唯一 dteam 工具入口
src/tui/dteam-dialog.ts         /dteam 列表、详情、Takeover View
```

这是职责切分，不要求预建空目录。旧 `src/leaf.ts` / `src/session.ts` 的模型解析、fallback、超时和并发应按行为迁移；不得把旧 Orchestrator Loop 或 TTL store 搬回。

## 9. 验收证据

0.8 完成前至少要有以下可自动复验的证据：

1. Worker 派发立即返回 `DispatchAccepted`，主对话可继续；完成结果按短窗汇聚回传。
2. `progress` / `finding` 不打断主对话；`failed`、`timed_out`、`cancelled`、`shutdown`、四种阻塞请求立即回传。
3. `request_tools` 只能激活注册的 `addTools` 候选；非法工具名明确 `deny`，而非被 Pi 静默吞掉。
4. 授权后同一个 `AgentSession` 的 `getActiveToolNames()` 含新工具，worker 由原阻塞 signal deferred result 继续而非创建新 session。
5. 取消需要确认、产出独立 `cancelled` + `user_cancelled` 原因，结束 worker 不可接管。
6. `/dteam` 可在无活跃 worker 时显示历史、在有活跃 worker 时显示实时 Snapshot；status 仅在活跃时存在。
