# Changelog

本文件记录 dteam 的用户可感知变更与关键实现收口。  
格式参考 Keep a Changelog，但保持中文、简洁、面向项目实际。

## [Unreleased]

## [0.9.0] - 2026-07-21

### Added
- `dteam_respond` 新增 `cancel` 响应：主代理在 worker 请求交互（waiting）时可直接取消该 worker，用于接管任务时停掉后台 worker，避免 `deny` 后 worker 空跑、完成时回放打断主代理；不是通用 cancel 工具，只在 worker waiting 时可用，详见 ADR 0023。

## [0.8.9] - 2026-07-20

### Fixed
- 无 `writeScope` 且没有 assistant 文本和 `WorkerReport` 的只读 worker 失败现在仅保留给后续 `dteam_wait`（显式等待）和 `/dteam`（管理视图）查询，不会在主代理 settled（稳定）后触发冗余 follow-up（后续轮次）；可写中断、timeout recovery（超时恢复）请求与其他失败通知保持不变。
- 可写 worker 的 timeout recovery（超时恢复）已发出并被消费 `write_interrupted`（写入中断）守卫后，选择 `stop` 不再强制重复回传同一 scope；首次中断守卫仍保留，确保主代理可执行完整性检查。

## [0.8.8] - 2026-07-19

### Fixed
- 主代理已通过 `dteam_wait`（显式等待）处理 timeout recovery（超时恢复）并选择 `stop` 后，`dteam_recover` 现在同步返回终态，且不再在主会话 settled（稳定）后追加冗余 failed follow-up（失败后续轮次）；`/dteam` 仍保留终态与可写 worker 的中断通知。

### Verification
- `npm test`（20 files / 151 tests）、`git diff --check` 与 Pi 扩展加载通过；新 Pi 进程并发派发 4 个短小 T3 worker 均完成，未出现真实 worker timeout。

## [0.8.7] - 2026-07-18

### Changed
- 开发与测试链路改为 Bun（直接执行 TypeScript）：移除 `tsc`（TypeScript 编译器）、Vitest（测试框架）和预编译配置，`npm test` 直接运行 `bun test`。
- 测试改用 `bun:test`（Bun 测试 API）；因 Bun 模块 mock（模拟）在进程内共享，测试以单并发运行以确保隔离稳定。

### Verification
- `npm test`（20 files / 150 tests）与 `git diff --check` 通过。

## [0.8.6] - 2026-07-17

### Added
- 新增主代理证据驱动多轮路由协议：非极小代码任务默认按互补证据面派 T3，汇总后只为具体缺口追加下一轮；外部信息由主代理选源后交 T3 有界提取，长期目标继续由 dgoal / issue / spec 等外部地图持有。
- `dteam_report` 新增任务 `outcome`、实际 `activities` 与必填 `verification`，明确区分 Manager 完成、任务完成、执行动作、验证结果和剩余未验证项。
- 新增独立 `~/.pi/agent/dteam-usage.jsonl` 脱敏数字账本，记录所有 worker assistant message（含失败、fallback 与恢复 attempt）的 token、cache 与 cost，供 `pi-session-insights` 只读聚合。

### Changed
- worker 报告旧形状不再兼容；reload 后必须提交 `outcome / summary / activities / facts / verification / uncertainties?`。completed event 仍只为 facts 注入真实 `workerId`，verification 不进入 handoff。
- `dteam_wait` 展开结果与 `/dteam` 终态详情现在以人类可读方式显示报告完成度、动作、验证深度、证据、remaining 和 uncertainties，不暴露原始 JSON。
- 同步系统架构、触发协议、API、源码地图、路线图、术语表与 Wayfinder / Ponytail 调研结论；routing benchmark 改为后续证伪与收窄机制。

### Fixed
- parent event 改为单次消费：事件发生后先进入 Manager 待消费队列；`dteam_wait` 即使晚于事件也会删除待回放项，主代理 idle / settled 后只回放仍未消费的事件，避免已知结果再次触发 follow-up。
- worker 终态、候选切换、超时与取消路径现在在 bounded abort 后调用 `AgentSession.dispose()`，并忽略旧 Pi 兼容 tick 遇到的 stale ctx，避免 print/JSON 进程完成后残留活动句柄或抛出生命周期异常。
- 同档模型候选失败切换时使前一 candidate 的报告 token 失效并清除其 WorkerReport，防止 fallback 未报告却复用旧 facts / activities / verification，或接收旧 session 迟到报告后被误判为 completed。
- `dteam_report` 不再消耗工作工具额度；其公开 schema 现在与 parser 一致约束 `none + not_run + []` 及非空验证证据。
- `WorkerManager.receiveReport` 现在也复用统一 parser，防止非工具回收路径绕过 WorkerReport 枚举、必填字段与交叉不变量。
- `dteam_wait` 的人类可读报告投影会过滤 ESC 等 C0/C1 控制字符，与 `/dteam` 详情保持相同终端安全边界。
- 修复 `dteam_wait` 消费 worker 终态事件后状态栏仍残留运行中数量的问题；状态栏现在跟随 Worker Manager 生命周期变化同步清理。

### Verification
- `npm run build`、test typecheck、`npm test`（20 files / 150 tests）、Pi 扩展加载与 `git diff --check` 通过。
- fresh Pi JSON smoke 成功通过 `dteam_wait` 单次消费 `completed` 事件，未产生重复 follow-up，进程正常退出且用量账本持续追加。

## [0.8.5] - 2026-07-16

### Added
- 新增 `dteam_dispatch`、`dteam_respond`、`dteam_recover`、`dteam_wait` 四个公开模型工具；worker 完成前必须提交结构化 `dteam_report`，主模型可通过有界 `handoff` 传递带来源事实。
- 新增显式依赖等待：可等待指定 worker 的下一可消费事件，返回部分结果或 timeout，不取消后台 worker，也不重复 follow-up。
- 新增可写 worker 的 `writeScope` 与 `write_interrupted` 守卫：中断、超时、失败、取消、shutdown 或缺报告时回传受影响范围，供 fresh T3 完整性检查。

### Changed
- T1/T2/T3 统一改为默认只读；`edit` / `write` 必须按每次派发显式最小授权。
- timeout recovery 从普通回应中拆出，改由 `dteam_recover` 专门处理；所有工具结果默认紧凑显示，`Ctrl+O` 展开回应、恢复、报告与 request 等完整但人类可读的详情，不展示原始结构。
- `dteam_wait` 默认显示目标 worker、已等待时长与 timeout 上限；执行中每秒刷新计时。

### Fixed
- 修复升档 recovery 遗漏 `dteam_report`、复用前一 attempt 报告，以及 timeout 终态遗漏写入范围的问题。
- 限制并脱敏 handoff，拒绝未定义交接字段，避免把超长或敏感上下文传给 fresh worker。


## [0.8.4] - 2026-07-15

### Changed
- 校准仓库项目地图：归档已推翻的架构、路线图和实施材料，并补齐当前运行时、测试与决策导航。

## [0.8.3] - 2026-07-15

### Changed
- `/dteam` 管理弹窗将运行中 worker 与终态历史拆为可用左右方向键切换的两个视图；历史按最新终态优先显示。列表与详情支持有界键盘滚动，避免大量 worker 堆积后被 Modal 裁切而无法查看。

### Fixed
- worker 进入 timeout recovery 前会清理旧的阻塞请求，避免过时回应跨 fresh attempt 残留。
- `/dteam` 详情以 worker ID 保持目标，worker 结束后仍显示原记录；非交互降级输出同时包含运行中与历史记录。

## [0.8.2] - 2026-07-15

### Added
- worker 可通过有类型 signal 向主代理申请一次 +60～+120 次（10 的倍数）的工具额度；追加后仍耗尽时明确交由主代理重新派发 fresh worker，不自动续派。

### Changed
- worker 工作工具调用额度改为按档位分配：T3 60 次、T2 120 次、T1 180 次；`dteam_signal` 不计入额度。

### Fixed
- 修复历史 `dispatch` 路径未解析 `provider/model[:thinking]` 模型候选后缀，确保模型 ID 与思考强度正确传入 fresh worker。

## [0.8.1] - 2026-07-14

### Added
- 跨档升级改为主代理决策式 `T3 → T2 → T1`（ADR 0012）；同档模型候选仍可自动回退。
- worker timeout 进入可恢复生命周期：主代理经 `dteam.respond` 选择同档 `retry`、相邻 `escalate`、`extend` 或 `stop`；恢复创建 fresh worker 并注入有长度上限的裁剪摘要。
- `/dteam` 列表和详情实时展示 worker 文本、思考、当前工具、最后活动和 timeout 诊断。

### Changed
- 默认每次 worker attempt 预算为五分钟（`workerTimeoutMs=300000`），同一 worker 在当前会话内的 timeout recovery 累计上限为十分钟（`maxRecoveryBudgetMs=600000`）。
- 模型候选配置改为 dgoal 同款的 `provider/model[:thinking]` 有序数组；数组后续项作为该档位的回退链。
- 所有用户可见耗时和 timeout 文案使用 `s` 或 `mXs`，不再显示原始毫秒。

### Fixed
- 修复 worker 结果、实时 Snapshot 和 parent event 未统一脱敏的问题；常见密钥、连接串和 Basic Auth 凭据不会进入恢复提示或父代理事件。
- 修复后台 Worker 的工具调用上限未生效、初始 attempt 未遵守较小总预算、创建 session 期间取消不释放并发槽的问题。
- 修复重复 request、工具授权 API 异常、外部回调异常和 shutdown 延迟刷新 timer 导致的状态/生命周期问题。
- 修复 `/dteam` 管理 Modal 无包边、标题和关键 worker 信息的问题；现在显示居中边框、worker 计数、task、状态、档位和有效结果信息。
- 接入 `pi.i18n.v1` bundle：`/dteam` UI 默认中文，并随 `pi-di18n` locale 切换。
- 修复 worker 内部事件直接显示在主对话导致的重复消息，并增强 assistant 文本提取与 worker 最终文本约束。
- 补充 `dteam` 工具描述中的 T1/T2/T3 选档规则、fallback 行为和 dispatch/respond 用法边界。
- 进一步明确 T3 默认工具白名单、`addTools` 权限边界和 `respond` 不创建新 worker。
- 修复 worker 超时触发 `abort` 后被误报为“未返回 assistant 文本”的竞态。

### Verification
- `npm run build`、`npm test`（13 files / 105 tests）、Pi 离线扩展加载和 `git diff --check` 通过。
- 真实 Pi CLI smoke 成功受理 T3 `read` worker：`workerId=aee2f8a9-152d-4ef6-bdb5-afb15704c89e`、`state=queued`；主会话启用 `dteam,read`，未修改文件。

## [0.8.0] - 2026-07-14

### Added
- 实现 0.8 会话级 Worker Manager：`dteam` 立即受理 1–32 个 worker，后台执行并聚合完成结果。
- 实现 A/B/C 有类型 signal、阻塞 request/respond、受限动态工具、`/dteam` 管理视图和取消二次确认。

### Changed
- 唯一模型工具从 0.7 的 `dteam_dispatch` 切换为 `dteam({ type: "dispatch" | "respond", ... })`；`/dteam` 保留为用户管理命令。
- 新增必需的个人模型配置 `~/.pi/agent/pi-dteam.json`：T1/T2/T3 缺一不可；配置缺失或不完整时启动告警并拒绝派发，不再静默回落当前 `ctx.model`。
- 动态工具采用已注册候选激活并 fail-closed；第三方 extension 候选在无法最小安全加载时降级为 built-in 与 dteam custom 工具。
- 保留 T1/T2/T3 分级路由、同档候选回退、共享并发；跨档升级由主代理按 T3→T2→T1 决定。不恢复 workflow、Orchestrator Loop、TTL Signal Store、batch、P2P 或 resume。

### Fixed
- 修复 worker 取消或 session shutdown 无法立即打断 hanging prompt、并发槽迟迟不释放的问题。
- 修复 `/dteam` 管理视图不会随 Worker Snapshot 变化自动刷新的问题，并处理 steering / cancel 竞态产生的异步错误。

## [0.7.0] - 2026-07-10

### Added
- 新增唯一公开工具 `dteam_dispatch(task, tier, thinking?, tools?)`：每次调用创建 fresh、Logical Isolation（逻辑隔离）的进程内 worker；执行、可选 fresh 验收和回退均复用该工具。
- 新增 T1/T2/T3 档位：默认思考强度为高/中/低；T3 默认只读，`bash` / `edit` / `write` 必须由调用方在 `tools` 显式授权。
- 新增显式模型路由环境配置：`DTEAM_T1_MODEL` / `T2` / `T3` 及对应 `_FALLBACK_MODELS`；未配置主模型才回落当前 `ctx.model`，不猜测模型档位。
- 新增同档 provider fallback、worker timeout、Pi 取消和共享自适应并发；跨档升级由主代理决定。初始并发为 2，429 可降至 1。

### Changed
- dteam 从 0.6.0 Orchestrator Loop 入口切换为模型分级 dispatch；主模型负责路由，T3 可并行 fan-out，关键任务按需用 T1 只读 fresh 验收。
- `package.json` 与 `package-lock.json` 版本升至 `0.7.0`；根 README、AGENTS、术语表、架构/API/触发协议、路线图和 ADR 0008 同步当前行为。

### Fixed
- dispatch 的 deadline 现在覆盖并发槽等待、worker session 创建和 prompt；超时/取消会有界等待 abort，避免过早释放并发槽后启动 fallback。

### Removed
- 删除 0.6 Orchestrator Loop、Signal Store、五角色、Reporter、Signal UI、`/dteam` slash command 及其测试/类型/prompt；不保留兼容入口。

### Verification
- `npm run build` 与 `npm test` 通过（5 files / 36 tests）。
- 离线扩展加载成功（`pi -ne -e ./index.ts --offline --no-session --verbose --list-models`）。
- 真实 Pi 冒烟：`pi -ne -e ./index.ts --no-session --model minimax-cn/MiniMax-M2.7 --tools dteam_dispatch -p '...'` 调用 `dteam_dispatch(task="...", tier="T3", tools=["read"])`，返回 `status=done`、`tier=T3`、`fellBack=false`，未回退；其他 provider/模型仍需手验。
- 已创建 Git tag `v0.7.0`；npm publish 与远端 push 待 507 确认。

## [0.6.0] - 2026-06-22

> 初始重定义落地 2026-06-18；输出契约重构与端到端验证收尾 2026-06-22。

### 重定义
- dteam 从「后台二维编排引擎」重定义为「基于 goal 自发生长的多 worker 群策群力扩展」。18 条根本决策钉死在 [ADR 0005](./doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md)。
- 明确与姊妹项目 `pi-dgoal` 的边界：**dteam = 群策群力（召唤池），dgoal = 建检循环（单兵 + 独立审核）**，独立并列，不合并、不自动切换。

### 推翻（保留追溯）
- 推翻 [ADR 0003](./doc/决策档案/0003-后台运行依附Extension-Runtime而非单次tool-call.md)（后台运行依附 Extension Runtime）：dteam 改为同步前台 Orchestrator Loop，不再返回 `runId`、不再后台运行。
- 推翻旧 0.6.0「Task Plan + Live Plan + `mode: solo/chain/team`」：无预先 Task Plan，召唤轨迹即计划。
- 删除二维编排（`solo/chain/team` 组织模式 × `direct/build_check/adaptive` 执行策略）、planner 穷举 / quick rule-based plan / LLM JSON fallback、`SchedulingPlan`/`FileGraph` 主轴、进程级 OS 子进程隔离作为默认。

### 输出契约重构与端到端验证收尾（2026-06-22）
- Orchestrator 决策从「自由文本 JSON + 正则解析」改为 **Pi tool calling 契约**：新增 `orchestrator_decide` customTool（`decision-tool.ts`），LLM 调用即结构化决策，runLoop 从 receiver 取。消灭探测报告 P0-1（JSON 截断致 goal fail）。
- check 收口从「关键词猜 passed」改为 **tool calling 契约**：新增 `check_conclude` customTool（`check-tool.ts`），passed/issues/summary 结构化。消灭 P0-4（check 判定脆弱）。
- Orchestrator task 字段加 maxLength=200 约束（`decision-tool.ts`），缓解 P1-2（task 无长度约束）。
- `parseOrchestratorDecision` 标记废弃（tool calling 上线后无调用点，保留备查）；`parseCheckResult` 降级为 check_conclude 未被调用时的兜底。


#### worker 执行防护
- `leaf.execute` 加 maxToolRounds 上限（默认 8，`config.ts`），超限调 `session.abort()` 中断，防慢模型无限工具调用。配合探测报告的 worker 不收敛问题。
- `leaf.execute` 支持 `extraCustomTools` 透传，供 runCheck 注入 `check_conclude`。


#### Orchestrator 约束（防失控）
- **目标性质→角色能力**（P0-2）：system prompt 明确只读/信息类目标（读/查/说明/解释/定位）不得召唤 build/close，防 worker 越权改仓库。
- **连续失败换策略**（P0-3）：SummonStep 加 `interrupted` 字段标注被工具上限中断的 worker；user prompt 在同类角色连续≥2次失败/中断时追加换策略警告；system prompt 强制换角色/缩小 task/收口。
- **explore prompt 收敛**（P1-1）：`agents/explore.md` 从"全面普查"重写为"聚焦目标够用即停、从最相关文件开始、单次召唤有限、按需探索非穷尽"，防 worker 过度工具调用。
- **task 长度上限**（P1-2）：orchestrator_decide tool 的 task 字段 maxLength=200（已在 tool calling 契约中落地）。


#### 修复
- `role-config.ts`：explore 去掉硬编码的 `tinyfish_search/tinyfish_fetch`（违反 ADR 0005 第 11 条 Logical Isolation）；`reference_architecture` 从所有角色 tools 移除，仅保留 design（session.ts 只给 design 注入该 customTool）。
- `index.ts`：删除 `DTEAM_ENABLE` 环境变量门禁（加载机制本身即开关，冗余设计）。
- `orchestrator-loop/decision.ts`：修正相对路径（`../../` → `../`，让 build 真正通过）。

### 新增（0.6.0 形态，代码已实施）
- Orchestrator Loop（编排循环）：同步前台主循环，LLM 驱动每轮召唤决策（`orchestrator-loop.ts` + `decision.ts`）。
- 进程内 `AgentSession` worker + Logical Isolation（逻辑隔离）：`session.ts` logicalIsolation 跳过 `discoverAndLoadExtensions`。
- session.subscribe 双通道：worker 执行时被动采集 turn_end 作为 progress 信号，与 `worker_sendSignal` customTool 并存。
- Signal Store（信号存储，TTL 衰减 `2^(-age/halfLife)`，单 goal 生命周期，不落项目目录）：`signal-store.ts`。
- Adaptive Concurrency（自适应并发）：429 降并发、连续成功升并发、cooldown 冷却（`concurrency.ts`）。
- Multi-Provider Routing（多供应商路由）：per-role 主模型 + fallback 链（`model-routing.ts`）。
- Completion Gate（收口闸门）：强制 `check` 收口，Orchestrator 不能自停（`check-gate.ts` + loop done 分支）。
- 启动方式 C 混合：`/dteam <goal>` 显式启动 + 主 LLM 自动拉起。

### 文档
- 新建 ADR 0005，重编号消除两份同名 0001 冲突（现为 0001~0005 唯一编号）。
- 重写术语表、路线图、doc/README、5 份架构文档（10/11/12/13/14）。
- 新建根 `README-zh.md`（中文版），重写根 `README.md`（英文版）对齐 0.6.0。
- 同步 `AGENTS.md`：撤销「不要做自适应并发」禁令，加 0.6.0 并发口径更新说明。
- 归档 `41-v0.5.0` 实施方案到 `doc/90-归档/版本实施方案/`。

### 代码实施（Phase 0–5）
- 删除旧编排源码：`orchestrator.ts` / `planner.ts` / `pool.ts` / `orchestrator/*`（strategies/history-context/signal-handlers/help-self-heal/peer-forwarder）/ `scheduler/*` / `ui/helpers.ts`。
- 删除旧二维编排类型：`tools.ts` 重写为纯 re-export；`ArchitecturePattern` 移到 `reference-data.ts` 本地。
- UI 层降级：`reporter.ts` no-op；`ui/store.ts` 删 mode/scheduling/strategies 字段；`ui/panel.ts` 重写为最小 worker 展示。
- `index.ts`：action=run 改走同步前台 `runLoop`（删后台 runId/activeRuns/sendMessage triggerTurn/旧渲染分支/dteam-report 渲染器）；工具 description/enum 对齐同步前台语义。
- 删除 14 个依赖旧结构的测试，`tests/README.md` 重写。
- `package.json` version 0.5.0 → 0.6.0；`src/README.md` 重写为 0.6.0 结构。

### 说明
- **代码已实施**：`src/` 已从 0.5.0 后台二维编排重写为 0.6.0 同步前台 Orchestrator Loop，140 个单测全绿（vi.mock 验证决策流转/并发/路由）。
- **版本号 0.6.0**：代码行为已是 0.6.0（同步前台 Orchestrator Loop + 强制 check 收口）。
- **待手动验证**：端到端真实 LLM 跑通 `/dteam <goal>` 需在有 API key 的 Pi 环境手验。

## [0.5.0] - 2026-06-11

### 新增
- 新增轻量依赖图调度：基于 `PlanStep.files` 生成 `FileGraph`，支持相对 `import`、`export from`、`require`、目录 `index.*` 和 JS/TS 常见扩展。
- 新增 preflight scheduling：`team` 模式在执行前识别 hard conflict、shared file、dependency edge、unknown boundary，并生成可解释 `SchedulingPlan.batches`。
- 新增 `pi.appendEntry()` checkpoint：写入 `dteam-plan` 和 `dteam-scheduling`，不污染 LLM context。
- 新增 `dteam-report.details` 的 plan / fileGraph / scheduling / step task-strategy-files，完成后可回溯计划、批次和冲突原因。
- 新增运行态 compact widget（小组件）任务树：显示 mode、done/total、耗时、running worker 最新输出、delayed reason。
- 新增 `/dteam` 内容型 tabs：`0 概览`、`1 批次`、`2 Workers`、`3 信号`、`4 报告`。

### 变更
- `team` 不再只按固定 batchSize 顺序并行，而是先经过 preflight batches；无冲突仍并行，有明确冲突则自动拆批。
- `solo` / `chain` 只附带 fileGraph / scheduling 信息，不改变 planner 给出的执行顺序。
- 完成态不再立即清空：widget 和 `/dteam` 保留上一轮结果，直到下一次 `dteam(action="run")` 开始。
- done worker 在 widget 中使用删除线 + dim 弱化；running / failed / delayed 使用更清晰的图标和颜色语义。
- `Workers` tab 显示 step files，每个 worker 最多显示 2 行输出，避免 debug panel 式堆叠。
- `SchedulingPlan` 增加 `delayedSteps`，用于解释每个被延后的 step 和原因。

### 不做
- 不做固定 6 阶段流水线。
- 不开放自定义角色系统；继续保留 5 个写死角色。
- 不做文件锁、worktree、自动 merge/rebase。
- 不默认做持久化 / resume（恢复）/ 进程级隔离。
- 不引入 TypeScript compiler API 或 Babel AST；file graph 保持文本扫描。

### 验证
- `npm run build` 通过。
- `npm test` 通过（19 个测试文件，302 个测试）。

## [0.4.2] - 2026-06-11

### 变更
- 文档层重新校准 dteam 定位：Pi 里的轻量多 subagent（子代理）协作引擎；简单任务主 LLM 直接干，复杂任务才调 dteam。
- 路线图将固定流水线降级为“暂不做”，把 UI 可观测性作为 0.5 起点。
- 补充 @juicesharp/rpiv-todo、SwarmFlow、MiMo Code、pi-subagents 的借鉴边界。

### 说明
- 本版本主要是文档与发布元信息调整，不改变运行时 API（接口）。

## [0.4.1] - 2026-06-08

### 新增
- 新增后台任务稳定性实施方案，后续已归档到 `doc/90-归档/版本实施方案/42-v0.4.1-后台任务稳定性实施方案.md`。
- 新增 `tests/index-background-run.test.ts`，覆盖“后台 `run` 立即返回后不再调用 `onUpdate`（流式更新回调）”的回归场景。
- 新增根目录 `CHANGELOG.md`，用于记录版本级用户可感知变更。
- `dteam-report`（结果报告）完成消息进入主对话，避免用户只看到启动 `runId`。

### 变更
- `dteam(action="run")` 明确采用**后台任务模式**：启动时只返回 `runId`（任务编号），实时进度主要通过 `/dteam` 面板、widget、状态栏观察，完成后再通过 `dteam-report` 通知主对话。
- 启动通道与运行态展示通道分离：工具调用返回后，后台执行只更新 UI / 状态栏 / 通知，不再借用已结束的工具调用通道。
- 保留 `availableTools`（可用工具列表）方案 D：继续由主 LLM 显式传入 worker 可用工具宇宙；dteam 不扫描运行时已加载工具。
- 文档导航、路线图、API 参考、系统架构说明同步更新为后台任务模型。

### 修复
- 修复后台任务在工具调用已结束后仍继续使用 `onUpdate` 导致的 `Agent listener invoked outside active run` 闪退问题。
- 去除后台 run 对 `onUpdate` 的依赖，避免越界发送 partial update（局部更新）。

### 验证
- `npm run build` 通过。
- `npm test` 通过（当前基线：16 个测试文件全通过）。

### 影响
- 用户调用 `dteam(action="run")` 后会立即拿到 `runId`，不应期待工具调用本身持续 stream（流式输出）。
- 实时过程请看 `/dteam` 面板；完成结果看 `dteam-report`。
