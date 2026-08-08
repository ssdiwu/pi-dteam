# 31-pi-intercom 跨会话通信与协议可靠性参考

> 调研日期：2026-08-08。
>
> 调研对象：[`nicobailon/pi-intercom@63fb02e`](https://github.com/nicobailon/pi-intercom/tree/63fb02eda4fbb847814d592617c83b3fd5e6cdf7)（`v0.9.2`，MIT）。
>
> 本文是外部能力参考，不是把 `pi-intercom` 并入 dteam 的架构决定。当前 dteam 定位、运行时和主动协调权威仍是 [ADR 0008](../决策档案/0008-dteam重定位为模型分级路由执行层.md)、[ADR 0020](../决策档案/0020-主代理证据驱动多轮路由协议.md)、[ADR 0021](../决策档案/0021-结构化工作报告区分动作完成度与验证深度.md) 与 [ADR 0024](../决策档案/0024-主代理运行中主动协调成为默认能力.md)。
>
> **后续落地状态（2026-08-08）**：候选 A 已完成最小实现。回归测试先复现旧 primary candidate 的迟到 finding 被 same-tier fallback 接受，再让每个 worker 生成的 `dteam_signal` 与 `dteam_report` 同样绑定 `candidateId`；旧 candidate 的 progress / finding / request 及 timeout fresh retry 后的迟到 signal 均被拒绝，当前 candidate 正常路径保持可用。

## 1. 总体判断

**值得吸收，而且价值主要在协议可靠性、主动控制与产品交互，不在改写 dteam 的核心定位。**

两个项目解决不同层级的问题：

- `pi-intercom` 回答“同一台机器上的独立 Pi 会话如何发现彼此并可靠通信”；
- dteam 回答“一个主代理如何把有界任务分级派给 fresh worker，并治理其权限、生命周期、证据、恢复与验收”。

最合适的组合关系是：

```text
Pi 顶层会话 A
  └─ 主代理 + dteam Worker Manager + fresh workers
          ↕
     pi-intercom 本机会话通信层
          ↕
Pi 顶层会话 B
  └─ 主代理 + dteam Worker Manager + fresh workers
```

因此，`pi-intercom` 不应替代 `dteam_signal`、`dteam_report`、Worker Manager、`writeScope` 或 fresh 验收；但它暴露了 dteam 当前值得继续校准的五个问题：

1. candidate / attempt 切换后，迟到信号是否仍属于当前执行轮次；
2. 主动 control 只表示调用返回，还是能区分 queued / injected / acknowledged / superseded；
3. `/dteam` 是否应显示 worker 的实时 context usage；
4. 阻塞 request / reply 是否能更自然地消歧与批量回答；
5. 顶层 Pi 会话之间是否需要一个可选、脱敏、非对话的适配层。

前四项可以在不改变 dteam 定位的前提下独立验证；第五项只有出现稳定的跨会话需求后才值得原型化。

## 2. 来源与证据范围

### 2.1 固定一手源

| 来源 | 固定边界 | 本文读取的关键位置 |
|---|---|---|
| `nicobailon/pi-intercom` | commit [`63fb02e`](https://github.com/nicobailon/pi-intercom/commit/63fb02eda4fbb847814d592617c83b3fd5e6cdf7)，tag `v0.9.2` | `README.md`、`CHANGELOG.md`、`package.json`、`index.ts`、`types.ts`、`extension-api.ts`、`broker/*.ts`、UI 与测试 |
| GitHub repository metadata | 2026-08-08 查询 | release、tag、提交、贡献者、stars / forks、open issue / PR |
| npm registry | 2026-08-08 查询 | `pi-intercom@0.9.2` 发布时间与依赖元数据 |
| Pi package marketplace | 2026-08-08 查询 | 包类型、下载量与静态安全扫描 |
| 当前 dteam | 2026-08-08 工作树代码与现行 ADR | `src/runtime/{worker-manager,signal-tool,report-tool,types,request-state}.ts` 与现行架构文档 |

### 2.2 本地复验

在固定上游 commit 上执行：

```bash
npm ci --ignore-scripts
npm test
```

结果：`136` tests passed，`0` failed。覆盖 broker framing、路径与权限、spawn、运行时 claim、client、extension bus、stable ID、ask/reply、busy queue、cancel/supersede、mailbox、UI renderer 等路径。

依赖扫描：

- 完整开发依赖树：12 个 advisory（1 low、3 moderate、8 high）；
- `npm audit --omit=dev`：生产依赖剩 1 个 low advisory，来自 `tsx → esbuild`；
- Marketplace 静态扫描标记 HIGH，主要命中预期内的 child-process spawn 与 environment access。该结果不能证明恶意，但确认扩展具备真实本地代码执行能力，安装前必须审阅源码与配置边界。

### 2.3 未覆盖与时效限制

- 本次没有在两个真实 Pi TUI 会话中安装并执行 `list → send → ask → reply → busy queue → reconnect` 冒烟；自动测试通过不等于真实交互体验已验证。
- 未做长时运行、睡眠唤醒、异常 broker 重启与高频消息压力测试。
- 2026-08-08 仍有用户报告的 open issues，集中在 session list 与实际在线状态不一致、busy inbound message 变旧、短 ID 前缀歧义；这些是未关闭报告，不直接等同于已复现缺陷。
- GitHub stars、forks 与下载量只说明关注和传播，不证明生产可靠性。

## 3. pi-intercom 核心机制

### 3.1 独立 Pi 会话的 1:1 通信

扩展为每个已加载且启用的 Pi 会话注册：

- `intercom` 工具：`list`、`list-cwd`、`send`、`ask`、`reply`、`pending`、`status`、`cancel`；
- `/intercom`：会话选择与消息撰写 overlay；
- `/intercom-id`：把稳定目标片段插入编辑器；
- `Alt+M`：打开会话列表；
- 条件式 `contact_supervisor`：只在 `pi-subagents` 提供完整 child bridge metadata 且没有原生 supervisor channel 时注册。

列表只展示已经加载、启用并成功注册到 broker 的 intercom 会话，不代表机器上的全部 Pi 进程。

### 3.2 本机 broker 与受限 transport

第一个需要连接的会话自动启动独立 TypeScript broker；最后一个会话断开后，broker 等待 5 秒再退出。

默认 transport：

- macOS / Linux：Unix domain socket；
- Windows：named pipe；
- Windows localhost TCP：仅显式 opt-in，使用动态 `127.0.0.1` 端口和本地 state secret。

runtime 目录默认位于 `~/.pi/agent/intercom`，也跟随 `PI_CODING_AGENT_DIR`。Unix 目录与文件分别收紧为 `0700` / `0600`。

wire format 是 4-byte big-endian length + JSON payload，frame 上限 1 MiB。broker 还限制连接数、未注册连接数、注册超时与每连接速率。

### 3.3 `send`、`ask` 与 `reply`

- `send`：fire-and-forget，broker 确认投递或返回失败，不等待业务回复；
- `ask`：仍发送普通 message，但 client 等待来自预期 sender 且精确匹配 `replyTo` 的回复；默认 10 分钟超时；
- `reply`：receiver-side sugar，优先回复当前触发轮次的 ask；否则回退到唯一 unresolved inbound ask；多条待回复时必须通过 `pending` 或显式 `to` 消歧。

broker 拒绝 self-target、歧义名称、伪造 `replyTo` 和互相反向等待的 mutual ask，避免两个会话彼此阻塞。

### 3.4 投递生命周期、去重与控制

message 端到端携带稳定 ID、sender sequence 与 broker / receiver / injection 时间戳。receiver 可回传：

- `receiver_received`
- `queued`
- `injected`
- `acknowledged`
- `expired`
- `cancelled`
- `superseded`
- `cancellation_requested`

相同 message ID 在同一 receiving session 最多注入一次。timeout 不等于 cancellation：超时后消息仍可能排队或已经可行动；取消必须显式请求。

`cancel` 只允许原 sender 操作自己的 message；未注入消息可从队列移除，已注入消息只能收到可见的 `cancellation_requested`。`supersedes` 只允许同 sender → 同 receiver 的替换，retry 不自动发生，必须创建新 message 并可用 `retryOf` 关联旧消息。

### 3.5 busy / idle 门控与上下文注入

receiver 收到 message 后先回执并去重：

- idle 时可按 `inboundTrigger` 触发新 agent turn；
- busy interactive session 先排队，回到 idle 后第一条触发、其余 follow-up；
- `inboundTrigger` 支持 `always`、`replies`、`never`；无效配置 fail-closed 为 `never`；
- async startup、flush、reconnect、overlay 与 relay 都用 runtime generation / live context 守卫，session shutdown 或 reload 后 no-op。

默认 `inboundTrigger="always"` 便利但扩大提示注入面；更严格环境应从 `replies` 或 `never` 开始。

### 3.6 断线 mailbox

broker 为近期断线、可识别的命名会话维护有界内存 mailbox：最多 256 条，保留时间上限 24 小时，但 broker 重启即丢失。按 ID 重连可取回；按名称回送还必须唯一且 cwd 归一化后相同，避免同名不同项目误收。

这不是 durable task queue，也不能提供跨 broker restart 的完成保证。

### 3.7 非对话 extension bus

其他 Pi extensions 可在 `session_start` 经 Pi event 注册 namespaced capability，并获得：

- `snapshot()`
- `publish(payload, { audience: owner | capable, ownerOnly? })`
- `commitState(payload, expectedRevision?)`
- `listSessions()`

此类 traffic 不调用 `pi.sendMessage()`、不进入 transcript、也不触发 agent turn。

broker 为每个 namespace 选择一个 owner，socket replacement 时更新 epoch；owner-only publish 和 state commit 必须匹配当前 owner session、exact socket 与 epoch。消息 payload 上限 16 KiB，持久 state 上限 64 KiB，state commit 使用 compare-and-swap 并带 hash、temp write、fsync、backup 与 atomic rename。

## 4. 与 dteam 的关系

### 4.1 正交能力

| 维度 | pi-intercom | dteam |
|---|---|---|
| 管理对象 | 独立顶层 Pi sessions | 当前主会话内 fresh worker sessions |
| 主要职责 | discovery、presence、direct messaging | model tier routing、execution、control、report、verification |
| 所有权 | 会话彼此独立；broker 只路由 | 主代理唯一 owner；Manager 只治理已派发 worker |
| 信息合同 | 通用 message / extension payload | typed signal、WorkerReport、bounded handoff |
| 权限合同 | 本机同用户 trust posture | tool allowlist、dynamic activation、writeScope、Logical Isolation |
| 持久性 | transcript + 可选 extension state；mailbox 仅内存 | session-scoped runtime；不 resume worker，不保存 transcript |

两者可以同时存在，但不能把“跨会话 transport”偷换成“dteam worker runtime”。

### 4.2 同思路：印证现役设计

| pi-intercom 机制 | dteam 现役对应 / 启发 |
|---|---|
| timeout 不是 cancel | timeout recovery 与 cancel 分离，主代理显式 retry / escalate / extend / stop |
| received / queued / injected / acknowledged 分层 | Manager state、task outcome、activities、verification 分开，避免“动作发生=目标完成” |
| busy 时延迟注入 | finding 只在 actionable 时上行；follow-up 在 idle / settled 后单次消费 |
| duplicate suppression | finding 有界合并去重；parent event 只由 wait 或 follow-up 单次消费 |
| exact ID + name ambiguity | workerId / requestId 精确寻址，不靠自由文本识别状态 |
| invalid config fail-closed | 模型档位配置不完整时拒绝 dispatch；未知工具拒绝授权 |
| owner epoch 拒绝 stale writes | 值得核查 signal 是否也应 attempt-scoped，而不只 report scoped |

### 4.3 设计冲突：明确不借

1. **不以自由文本会话消息替代结构化 worker 协议。** `dteam_signal` / `dteam_report` 继续是唯一工作流信号与报告入口。
2. **不允许 worker P2P。** 所有 finding、request、control 和 handoff 继续经过主代理与 Manager 的星型边界。
3. **不把 broker 变成 Orchestrator。** transport、owner election 和 extension state 不得驱动下一 worker、tier 或依赖释放。
4. **不把 extension state 当 task plan / resume。** dgoal / issue / PRD / spec 保存耐久目标，dteam 不保存映射或恢复旧 worker。
5. **不把 session metadata 当 authentication。** 即使未来适配，cwd / model / pid / status 只能用于展示与弱消歧，不能授权写入或控制。
6. **不默认自动注入跨会话消息。** 自动触发会增加 prompt injection、上下文污染和主模型轮次，必须 opt-in、脱敏且有界。
7. **不因跨会话能力放松单一写入所有权。** 同一 worktree 同时只有一个 writer；intercom 只能通信，不能解决 file lock、merge 或写冲突。

## 5. 候选：值得吸收

### 候选 A（P0，已实施）：所有 worker signal 与当前 candidate / attempt 绑定

**已复现故障**：同档 candidate fallback 后，旧 primary session 的迟到 finding 仍只凭 `workerId` 进入当前 WorkerRecord。修复前定向测试期望“候选已失效”，实际没有错误，且旧 finding 可写入当前 snapshot / Signal Log。

**根因**：

- `makeReportTool(workerId, candidateId, host)` 会把 `candidateId` 传给 `receiveReport`；
- `receiveReport` 已拒绝与 `activeCandidateId` 不一致的旧报告；
- `makeSignalTool(workerId, host)` 原本没有 candidate 参数；
- `receiveSignal` 原本只检查 worker 是否终态，随后即可接受 progress / finding，或按 `workerId + requestId` 建立等待请求；
- candidate 失败时清理旧 report 与旧 RequestState，仍不能阻止旧 session 在清理后提交新 requestId 或无 requestId 的 finding。

**已实施修复**：内部 `makeSignalTool → receiveSignal` 链路携带创建该工具的 candidate ID，并复用 `receiveReport` 的 active candidate 一致性守卫；校验发生在写入 Signal Log、Snapshot、Request State 或 parent event 之前。五个公开主代理工具 schema、worker signal schema 与 Manager 路由职责均未改变。

**定向验证**：same-tier fallback 现持有旧 candidate 的全部七种 `WorkerSignal`（progress、finding、四类 request、blocked），均明确拒绝且不污染当前状态；timeout recovery 等待窗口和 fresh retry 另有回归，证明旧 attempt signal tool 始终失效、当前 retry signal 正常。与 control/context/request/TUI 一并运行的定向范围为 `75` tests passed。

### 候选 B（P1，已实施）：主动 control 的 queue lifecycle

**原合同缺口**：`dteam_control(steer)` 原来只证明 `session.steer()` Promise 完成，无法区分仍在 queue、已被 Pi 注入下一 agent turn，或在连续纠偏时被新指令取代。

**已实施修复**：每个 control 有内部 command ID 与 `queued / injected / superseded / expired`。Worker Manager 独占逻辑隔离 worker session；新 steer / graceful_stop 用 `clearQueue()` 移除该 worker 尚未注入的旧 control，随后提交新 control。`queue_update` 观察到指令离开 queue 时才标为 `injected`；fallback、retry、cancel、timeout 和终态会使未注入 command 变为 `expired`。

**语义边界**：`injected` 只表示 Pi 已从 queue 取走指令，绝不表示 worker 已理解或执行。运行时若缺 `clearQueue()`，第二条要求 latest-wins 的 control fail-closed；不静默允许旧指令迟到。没有新增公开输入字段或第六个工具。

**验证**：覆盖连续 steer 的 supersede、graceful_stop 优先、queue 离开后的 injected、未注入 cancel 后 expired，以及控制结果不外推 worker 已执行。

### 候选 C（P1，已实施）：Worker Snapshot 展示实时 context usage

**已实施修复**：Worker session 的 `getContextUsage()` 在 assistant `message_end` 与 compaction 结束时采样为只读 `tokens / contextWindow / percent / sampledAt`，并在 `/dteam` 详情展示。它不触发自动 steer、tier、retry、cancel 或恢复。

**一致性边界**：candidate 切换先清除旧 usage；迟到旧 candidate event 无法覆盖当前值。compaction 返回 `null`、老 runtime 缺 API 或 getter 异常都清除旧值，绝不把旧高水位误显示为当前值。

**验证**：覆盖正常采样、compaction unknown/null、getter 异常、same-tier fallback 旧 event、无 API mock 和窄宽 TUI。

### 候选 D（P2，已实施）：request / reply ergonomics

**已实施修复**：Snapshot 现在投影脱敏、有界的 pending request 摘要、精确 `requestId` 和允许的 response type；`dteam_wait` 展开结果按 kind 给出人类可读的 `dteam_respond` 提示，timeout recovery 明确改走 `dteam_recover`。不显示原始 JSON 或 request payload。

**边界**：没有新增工具、批量 interview 或结构化多问题协议；worker 仍不得把本应自行完成的工程判断转交用户。

### 候选 E（P3，未实施）：可选的顶层会话适配层

**真实需求前提**：同一用户长期并行运行研究、实现、审查或相关仓库会话，并反复需要脱敏 handoff、session presence 或完成通知；人工复制已经形成稳定成本。

**本轮产物**：只定义独立 companion 试点合同，未安装 `pi-intercom`、未改 WorkerManager、未添加 adapter、未执行双会话 smoke。第三方扩展安装仍需安全审计和单独确认。

**后续验证**：固定版本后以独立 companion 完成双会话 smoke；证明比人工复制更可靠，且不会造成重复触发、写入所有权冲突或敏感信息外泄，再讨论 ADR 与代码适配。

## 6. 当前验证顺序与状态

1. **P0：attempt-scoped signal——已实施。** 全部七种 WorkerSignal 已在 same-tier fallback 回归中验证；不扩成通用 epoch 系统。
2. **P1：control lifecycle——已实施。** 只记录 queue 可观察状态；不伪造 worker ack/execution。
3. **P1：context usage——已实施。** 只读展示，不自动路由。
4. **P2：request/reply 易用性——已实施。** 只改投影和提示，不扩 schema / 工具数。
5. **P3：双顶层会话试点——未实施。** 先走下方独立 companion 合同与安全确认，才决定是否需要 extension adapter。

四个已实施候选与后续 wait-view 投影修复已通过完整 `202` tests 和真实 `dispatch → control(queued) → request/respond → report/wait` smoke；E 在缺少重复人工复制成本或安全授权时保持未实施。不要先增加通用 message bus、持久状态、P2P、remote worker 或新的公开模型工具，再为它们寻找用途。

## 7. 安全与采用边界

如果把 `pi-intercom` 作为独立 companion 试用：

1. 固定版本并审阅发布 diff；扩展会启动子进程且可由 trusted local config 覆盖 broker command。
2. 初始设置 `inboundTrigger="replies"` 或 `"never"`，不从默认 `always` 开始。
3. 使用 exact session ID；名称只用于可读性，跨项目还需校验 cwd。
4. 不发送密钥、完整系统 prompt、完整 transcript、用户配置、私有绝对路径或未脱敏 WorkerReport。
5. same-machine 只表示本地 transport，不等于强身份认证；任何能以同一用户访问 runtime 目录或修改扩展配置的进程都在本地信任边界内。
6. 同一 worktree 保持单一 writer；另一个会话只读研究、独立 worktree 写入，或由主代理明确交接写入所有权。
7. 测试通过与静态扫描都不能替代真实双会话 smoke 和人工审阅。

### 7.1 本轮定义的 companion 试点合同（未执行）

1. 另行确认安装并重新审计固定版本；初始 `inboundTrigger` 使用 `never` 或 `replies`。
2. 两个会话以 exact session ID 与 cwd 消歧；只传 presence、完成通知或脱敏有界摘要。
3. 两个可能写入的会话使用独立 worktree；同一 worktree 保持单一 writer。
4. 双会话 smoke 必须分别证明：没有自动注入、没有重复触发、没有完整 prompt / transcript / WorkerReport 泄露，以及关闭一方不影响另一方。
5. 只有连续人工使用确证“复制交接”是稳定成本，才评估 `pi-dteam/v1` 只读 adapter；adapter 不进入 WorkerManager，不保存 task/dgoal ID，不自动 dispatch。

## 8. 决策记录

本调研不单独新增 ADR：

- dteam 的模型分级执行层、主代理 owner、Worker Manager 无语义路由、worker 无 P2P、无 resume 等现行决定不变；
- `pi-intercom` 作为跨顶层 Pi 会话通信参考，与 dteam 运行时正交；
- 候选 A 已以最小内部改动实施：worker 生成的全部 signal / report 工具统一绑定 candidate ID，公开主代理工具与路由边界不变；
- 候选 B/C/D 已在现有 runtime 内实施：control 只报告 queue 事实，context 只读，request/reply 只改善投影；均不增加公开输入 schema、工具数或自动路由；
- 候选 E 仍未实施，只有 companion 试点证明真实收益并完成安全评估后，才重新评估 ADR 与 adapter；
- 若未来采用 extension bus、持久状态、跨会话自动控制或公开协议变更，必须重新评估安全、所有权与 ADR 边界。

## 9. 可继续精读的上游位置

- [`README.md`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/README.md)
- [`types.ts`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/types.ts)
- [`extension-api.ts`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/extension-api.ts)
- [`broker/broker.ts`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/broker/broker.ts)
- [`broker/client.ts`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/broker/client.ts)
- [`broker/framing.ts`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/broker/framing.ts)
- [`broker/extension-state.ts`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/broker/extension-state.ts)
- [`skills/pi-intercom/SKILL.md`](https://github.com/nicobailon/pi-intercom/blob/63fb02eda4fbb847814d592617c83b3fd5e6cdf7/skills/pi-intercom/SKILL.md)
- [release `v0.9.2`](https://github.com/nicobailon/pi-intercom/releases/tag/v0.9.2)
