# 25-swarm-ide 蜂群 IM 编排参考

> `chmod777john/swarm-ide`：把多 agent 协作建模成"微信式 IM"的开源蜂群平台。极简原语 `create`（创建子 agent）+ `send`（向任意 agent 发消息）+ `wakeup`（消息唤醒），拓扑在运行中自演化，人类是特殊 agent 可介入任意层级。独立 Web 平台（Bun + Next.js + Drizzle/PostgreSQL + Redis Streams + SSE），不是 Pi 扩展。
> 仓库：https://github.com/chmod777john/swarm-ide
> 调研版本：`chore/specs-mvp` 分支（2026-01 发布，自称早于 Kimi-Swarm / Claude Team 提出蜂群模式）

## 1. 总体判断

> **关系口径**：swarm-ide 是 dteam 的外部参考源之一，与 ant-colony / pi-subagents / Routa 等平级，不高于 dteam 自身优先级。本篇主语始终是 **dteam 自己的痛点**，不是 swarm-ide 的功能清单——判断借不借，先问 dteam 有没有这个真实痛点（见 `doc/README.md` 当前文档原则第 7 条）。

swarm-ide 整体路线（动态 create 任意 role agent + 液态拓扑 + IM 即编排 + 长驻 runner）和 dteam 0.6.0 骨架直接冲突，不能照搬。真正可能落到 dteam 痛点上的，是三个**局部观察点**（可观察性 / 协议强化 / 模式库），但它们都是**参考性观察，不构成 0.6.0 实施任务**——是否吸收留待 dteam 出现真实痛点时再判。

这呼应 *Opinionated Subagent Replacement*（有立场的子代理替代层）：吸收能力形态，用 507 的工作流约束过滤，不追求功能复刻。

## 2. 核心机制速览

### 2.1 极简两原语 + 唤醒链

- agent 工具集只有 `create(role, guidance)` / `send(to, content)` / `send_direct_message` / `send_group_message` + IM 查询 + `bash` + `get_skill`。**`create + send` 两个原语即可表达任意拓扑**（树、路由、map-reduce 全靠这两个组合）。
- 每条 `send_*` 写入 `messages` 表后，调用 `wakeAgent(to)` resolve 目标 runner 的 deferred（延迟量），触发其 `processUntilIdle`（处理到空闲）。
- 唤醒链：`send` → `wakeAgent` → 目标 runner `await wake.promise` 解除 → `listUnreadByGroup`（按群聚合未读）→ LLM 推理 → 落库 → 回到阻塞。

### 2.2 长驻 runner + 单轮工具循环上限

- 每个 agent 一个长驻 `AgentRunner`，内部 `while(true)`：`await wake.promise` → `processUntilIdle` → 回阻塞。不同 agent 天然并行（多 runner）。
- `maxToolRounds = 3`：单个 agent 单轮推理内工具循环最多 3 轮，防 agent 卡在工具循环烧 token。
- ⚠️ 这套"长驻 agent + 同 agent 串行"是 **swarm-ide 的形态**，和 dteam 不同：dteam 的 `worker` 是一次性召唤的进程内 `AgentSession`（`leaf.execute` 每次都新建 session），并发召唤的是**多个新 worker 实例**而非同一个 worker，所以"同 worker 串行防状态竞争"这个约束对 dteam 不适用（见 §3.2）。

### 2.3 messages vs llm_history 分离

- `messages` 表：IM 可见消息（人/agent 之间**显式** `send_*` 发的）。
- `agents.llm_history`：单 agent 全局 LLM 对话（含 tool_calls），与 group 无关。
- **推理产出不自动写回 messages**——要对外通信必须显式调 `send_*`。若一轮没调 send，注入 reminder 再跑一轮 followup（`didSend` 协议强化）。

### 2.4 双层事件总线（可观察性核心）

- `AgentEventBus`（per-agent channel）：`agent.wakeup` / `agent.unread` / `agent.stream`（`reasoning` / `content` / `tool_calls` / `tool_result`）/ `agent.done` / `agent.error`。带 ring buffer（默认 2000）+ `getSince(afterId)` 增量拉取 + 可选 Upstash 跨进程持久化。
- `WorkspaceUIBus`（workspace 级 channel）：`ui.agent.created` / `ui.group.created` / `ui.message.created` / `ui.agent.llm.start` / `ui.agent.llm.done` / `ui.agent.history.persisted` / `ui.agent.tool_call.start` / `ui.agent.tool_call.done` / `ui.agent.interrupt_all` / `ui.db.write`。
- 前端 SSE 订阅 UI 事件 → 按事件类型决定拉侧边栏 / 拉当前 group / 拉 LLM history。

### 2.5 拓扑可视化 + LLM history 面板

- `agent-graph` 接口从 `messages` 反推边：`{from, to, count, lastSendTime}`，节点是 agent（含 `parentId` 组织树）。Graph 页实时展示蜂群拓扑与通信链路。
- 树状多级对话列表（微信式）：可选中任意层级 agent 对话，即使是深层子 agent。
- LLM history 面板：非流式展示单个 agent 完整 `llm_history`，agent 不再是黑箱。

### 2.6 spells（咒语）：自然语言编排模板

`spells/` 存可直接发给入口 agent 的编排提示词，只依赖 `create + send` 两原语：

| 咒语 | 模式 | dteam 对应 |
|---|---|---|
| `tree-executor` | 多级树递归（父→子→父汇总） | dteam 不做多层级（1 层调度），但"汇报+汇总"形态接近 `check` 收口 |
| `router-experts` | 按关键词路由到专家 | 接近 dteam Orchestrator 按信号选角色 |
| `map-reduce` | 并行分片→汇总 | 接近 dteam Adaptive Concurrency + Peer Forwarding |
| `critic-loop` | 生成→批评→改写循环 | 接近 dteam `build → check` 回路 |

## 3. 与 dteam 0.6.0 的关系

### 3.1 设计冲突（明确不借）

| swarm-ide 做法 | 冲突点 | dteam 立场 |
|---|---|---|
| `create` 动态创建任意 role 子 agent | 违反固定五角色 | ADR 0002：`explore/design/build/check/close` 写死，不做 agent market（代理市场） |
| 液态拓扑 / 嵌套 agent / agent 主动雇佣下属 | 多层 Hierarchical Delegation（层级委派） | dteam 故意 1 层调度；"自发生长"指任务从执行涌现，不是拓扑自演化 |
| IM 即编排（所有对话是群，messages 表驱动） | dteam 是 Signal Store（TTL 衰减），不是持久 messages | Signal Store 随编排循环结束清理，不落项目目录（见术语表） |
| 独立 Web 平台 + PostgreSQL 持久化 + 长驻 runner | dteam 是 Pi extension（扩展），进程内按需召唤 | ADR 0004：不做 resume / 默认持久化；worker 是进程内 `AgentSession`，不是长驻 OS runner |
| 人 = 特殊 agent，介入任意 worker 对话 | swarm-ide 是长驻 agent 平台，人天然可与任意 agent 聊；dteam worker 是一次性短驻 session | dteam 用户通过主 LLM 交互，不直接和 worker 聊；但 dteam 已有 `help` + `injectionQueue` 短驻反馈回路（`leaf.ts`），能在单 goal 内做到"人补充信息注入 worker"，不需要 swarm-ide 的全量直接对话 |
| Redis Streams / Upstash 跨进程实时 | dteam 单进程内 `session.subscribe` | 不引入跨进程消息中间件 |

### 3.2 同思路（dteam 已有，印证方向）

| swarm-ide 机制 | dteam 0.6.0 对应 | 关系 |
|---|---|---|
| `AgentEventBus` per-agent channel + subscribe | `session.subscribe` 承接 worker 事件 | **构成**：dteam 已有等价机制（`orchestrator-loop.ts` 的 `attachSubscribeToStore` 已挂 worker `turn_end`） |
| `send` 触发目标 agent wake | worker 结果/信号实时回 Orchestrator | **构成**：dteam 信号回路同构 |
| 同 agent 串行 / 不同 agent 并行 | Adaptive Concurrency（自适应并发） | **不对应**：swarm-ide 串行的是"同一个长驻 agent"；dteam 并发召唤的是多个**新** worker 实例，不存在"同一 worker 被并发召两次"，所以该约束不迁移 |
| spells 用自然语言咒语编排 | LLM-Driven Orchestration（每轮 LLM 决策） | **构成**：dteam Orchestrator 本质就在"念咒语"，且更彻底（开放式 LLM 决策，非固定模板） |
| `get_skill` 按需加载技能 | dteam `reference_architecture` 工具 | **构成**：同思路 |

### 3.3 候选（参考性观察，非实施计划）

> 以下是基于 swarm-ide 的观察点。**是否吸收留待 dteam 出现真实痛点时再判**——这些不构成 0.6.0 的实施任务。主语是 dteam 的痛点，不是 swarm-ide 的功能。

#### A. 可观察性——大部分已构成

核对 `src/ui/store.ts` + `panel.ts`：dteam 的 `UIWorkerState` 已覆盖 swarm-ide 事件表里的大部分能力（`currentTool`/`recentOutput`(ring50)/`signals[]`(ring100)/`status`+`startedAt`）。swarm-ide 事件里的 `agent.created`/`group.created`/`interrupt_all`/`db.write` 在 dteam 同步前台单 goal 模型里无对应物，不借。

唯一缺的**轮次维度**明确不做：用户对一次 dteam 的感知粒度是三段（开启 dteam → 完成工作 → 验收 check 收口），worker 内部工具调用轮次属于黑箱（见术语表 `Live Loop View`）。同理，debug 模式下钻 worker 完整 `llm_history` 也不做。

#### B. 协议强化——单 worker 工具循环上限（仅观察）

swarm-ide 用 `maxToolRounds = 3` 约束单个 agent 单轮推理内的工具循环轮数。dteam 现在只有 Orchestrator 级 `maxRounds`（召唤轮数上限），没有单 worker 内部工具循环上限——**如果未来出现 worker 烧 token 不出来的真实 case**，可参考这个解法。是否做、怎么做，留待真实痛点出现时再定（且需先确认 Pi SDK `createAgentSession` 能否配置该上限）。

swarm-ide 的 `didSend` reminder（未发消息就追问）在 dteam 无对应痛点：dteam 已有 `turn_end → progress` 自动信号兜底（`attachSubscribeToStore`）+ `check` 收口，结构上不会静默。

#### C. 模式库——spells 作为 reference_architecture 素材

dteam 已有 `reference_architecture` 工具（`reference-data.ts`），现仅注入给 `design` 角色。swarm-ide 的 4 个 spells（tree / router / map-reduce / critic-loop）是现成的协作形态描述，**未来如果 dteam 需要补这块模式词汇**，可参考。当前不作为实施任务。边界：spells 是参考素材，不升格为运行时模式（不违反 ADR 0005 的 LLM-Driven Orchestration）；是否扩大到其他角色是独立决策。

## 4. 可借鉴的具体文件

| 文件 | 价值 | 借鉴方式 |
|---|---|---|
| `backend/src/runtime/event-bus.ts` | per-agent ring buffer + `getSince(afterId)` 增量拉取 | **参考**：dteam `session.subscribe` 事件设计可对照 |
| `backend/src/runtime/ui-bus.ts` | workspace 级 UI 事件契约 | **参考**：dteam `UIStore` 事件粒度（但大部分已构成，见 §3.3-A） |
| `spells/*.md` | 4 个自然语言编排形态描述 | **素材**：未来补 `reference_architecture` 模式词汇时参考 |

## 5. 决策记录

- **2026-06-18**：初版调研 `chmod777john/swarm-ide`（`chore/specs-mvp` 分支），加入 `doc/20-能力参考/`。
- **2026-06-19（grill 修订）**：初版存在三个问题，已修正——
  1. **主语错误**：把参考关系写成"子集/对照清单"，主语是 swarm-ide 功能而非 dteam 痛点（违反 README 当前文档原则第 7 条），已全面改为 dteam 痛点主语；同时沉淀 `Live Loop View` 口径（用户感知 = 开启→完成→验收，worker 内部黑箱）到术语表。
  2. **伪痛点撤回**：初版的"同 worker 串行"（代码证伪：dteam 并发的是新 worker 实例）、"didSend reminder"（dteam `turn_end→progress` + check 已兜底）、"debug 下钻 worker history"（违反黑箱口径）三处候选撤回。
  3. **过度设计降级**：初版把候选写成实施级精度（静默生效口径等），已降级为参考性观察——是否吸收留待真实痛点出现时再判，不构成 0.6.0 实施任务。
- swarm-ide 的整体路线（动态 create agent / 液态拓扑 / IM 即编排 / 长驻 runner / 独立 Web 平台）违反 ADR 0002/0004/0005，明确不引入。
