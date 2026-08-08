# 30-Wayfinder、Ponytail 与证据驱动路由参考

> 调研日期：2026-07-17。
>
> **后续落地状态**：本调研完成后已通过 `507-grill`（实施前决策对齐）确认产品边界，并落地 [ADR 0020 主代理证据驱动多轮路由](../决策档案/0020-主代理证据驱动多轮路由协议.md) 与 [ADR 0021 统一 WorkerReport](../决策档案/0021-结构化工作报告区分动作完成度与验证深度.md)。文中“候选 / 待对齐”保留研究时序；现行权威以 ADR 为准，routing benchmark 改为证伪和收窄机制，不再是落地前置门。
>
> 本文不是给 dteam 增加外部 `Skill`（技能）的安装清单，而是研究这些机制是否暴露了 dteam 当前定位尚未覆盖的路由问题。判断基于一手仓库、作者文档、公开 issue（问题单）与官方 agent（代理）架构资料；外部仓库均固定到下文列出的 commit（提交）。

## 1. 总体判断

**部分值得吸收，而且价值比“已有哪个对应 Skill”更深。**

Wayfinder、Ponytail 与 `Critical Thinking → Fetch → Deep Thinking → Review → Loop` 共同指出：dteam 当前已经能回答“**哪一档模型来做**”，但对下面三个问题只分散写在 ADR（架构决策记录）和主代理约定里，还没有形成清晰、可评测的路由合同：

1. **什么已经清晰到可以派发**：未知是可精确表述的当前问题，还是尚不能切成任务的“迷雾”？
2. **是否根本需要实现**：已有代码、标准库、原生平台或现有依赖是否已经承载目标？
3. **什么证据足以改变下一轮路由**：一次代码读取、一次 build（构建）、一组行为测试和人工确认分别能证明什么，不能证明什么？

这不要求把 dteam 改回 Orchestrator Loop（编排循环）、Task Plan（任务计划）或持久工作流平台。更合理的演进方向是：

> **Worker Manager（工作者管理器）继续只管理已派发 worker；主代理采用证据驱动的逐轮路由：界定当前可知边界，派最低足够档位取证或执行，综合证据，按证明层级验证，再决定收口、继续取证、重试、升级或向人请求决策。**

这个方向与现定位兼容。后续 `507-grill` 已决定先把主代理协议与诚实的 WorkerReport 结果模型作为规范性默认落地，同时用 routing benchmark（路由基准）比较强模型直接做、T3-first（T3 优先）与其他路径；数据若反对，则收窄或推翻默认，而不是把 benchmark 变成长期拖延协议落地的门。

## 2. 来源与证据范围

### 2.1 主要一手对象

| 对象 | 固定版本 / 来源 | 本文读取的关键位置 | 机制 |
|---|---|---|---|
| Matt Pocock Wayfinder | [`mattpocock/skills@9603c1c`](https://github.com/mattpocock/skills/tree/9603c1cc8118d08bc1b3bf34cf714f62178dea3b) | `skills/engineering/wayfinder/SKILL.md`、`docs/engineering/wayfinder.md`、issue tracker（问题追踪器）约定 | destination（目的地）、fog（迷雾）、frontier（前沿）、decision ticket（决策票） |
| Ponytail | [`DietrichGebert/ponytail@16f2980`](https://github.com/DietrichGebert/ponytail/tree/16f29800fd2681bdf24f3eb4ccffe38be3baec6b) | `skills/ponytail/SKILL.md`、`ponytail-review`、`benchmarks/` | 最小方案搜索梯、正确性 / 安全下限、过度实现验收 |
| Meta Skill Creator | [`KimYx0207/meta-skill-creator@acc7b80`](https://github.com/KimYx0207/meta-skill-creator/tree/acc7b8003ee4ea2304c2a70a4630c6d633dc5855) | `SKILL.md`、`creation-rule-standard.md`、`closed-loop-governance.md` | Critical / Fetch / Deep / Review / Loop 阶段合同、证明层级、写回决定 |
| Superpowers | [`obra/superpowers@d884ae0`](https://github.com/obra/superpowers/tree/d884ae04edebef577e82ff7c4e143debd0bbec99) | `brainstorming`、`writing-plans`、`subagent-driven-development`、`verification-before-completion` | 强制设计门、细粒度计划、fresh subagent（新鲜子代理）、任务级双重审查 |
| GitHub Spec Kit | [`github/spec-kit@7bdf6c5`](https://github.com/github/spec-kit/tree/7bdf6c50416c2e7ea96d8398b569a78808adc6e9) | `docs/concepts/sdd.md`、`spec-persistence.md`、`evolving-specs.md`、`converge.md` | spec（规格）驱动、artifact（产物）权威、flow-back / flow-forward / living spec（回流 / 前向 / 活规格） |
| 12-Factor Agents | [`humanlayer/12-factor-agents@d20c728`](https://github.com/humanlayer/12-factor-agents/tree/d20c728368bf9c189d6d7aab704744decb6ec0cc) | factor 3 / 4 / 8 / 9 / 10 | 自有控制流、结构化工具输出、小而聚焦的代理、紧凑错误 |

### 2.2 官方同类与替代观点

- [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)（2024-12-19）：区分 workflow（预定义工作流）与 agent（动态代理）；给出 routing（路由）、parallelization（并行）、orchestrator-workers（协调者—工作者）、evaluator-optimizer（评估—优化）模式，并要求只在可证明提升时增加复杂度。
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)（2025-09-29）：强调 just-in-time retrieval（即时检索）、progressive disclosure（渐进披露）、低分辨率索引与按需放大，以及 subagent（子代理）只回传压缩结论。
- [OpenAI — A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)：建议先用最强模型建立质量基线，再逐步替换为小模型优化成本；优先单代理，只有复杂逻辑或工具过载造成真实失败时再拆多代理。

### 2.3 已核验的反证与限制

- Wayfinder 的 [issue #492](https://github.com/mattpocock/skills/issues/492) 暴露了 map（地图）到 `to-spec`（转规格）的 handoff（交接）边界不稳；[issue #518](https://github.com/mattpocock/skills/issues/518) 显示“决策票”容易被误标为“可执行票”。
- Superpowers 的 [issue #512](https://github.com/obra/superpowers/issues/512) 记录 monolithic plan（单体计划）反复读取的 token（令牌）成本；[issue #939](https://github.com/obra/superpowers/issues/939) 显示具体硬编码路径会压过项目级约定。
- Ponytail 的 [issue #597](https://github.com/DietrichGebert/ponytail/issues/597) 估算完整 Skill 注入每个 subagent 会重复消耗约 1,300 tokens；其自身 benchmark 也承认小型本地模型可能无法稳定遵循多级梯子。
- Ponytail 2026-06-18 agentic benchmark（代理基准）只在一个主要模型、有限任务与已知安全向量上验证，feature（功能）任务只统计 agent 留下的 diff，没有运行 server（服务器）或 browser（浏览器）；它证明的是“存在过度实现陷阱时明显有效”，不是所有任务都应增加一轮简化流程，更不是安全证明。
- Ponytail 的 2026-06-17 cost verification（成本复验）还显示 provider（供应商）差异：在 Claude 上成本下降 42–75%，但在 `gpt-5.4-mini` 与 `gpt-5.5` 上分别增加 26.2% 与 38.7%，后者延迟也略升。完整规则输入与额外 reasoning tokens（推理令牌）可能抵消短代码收益，因此不能把 ladder 注入当成普遍节省。
- OpenAI 的“先强模型基线，再向下替换”与 dteam 的默认 T3-first 构成直接 counterevidence（反证）：成本优先路由不能只靠直觉，必须测质量、升级率、总延迟与总成本。

## 3. 关键机制速览

### 3.1 Wayfinder：不要预先穷举迷雾，只派发当前前沿

Wayfinder 的关键不是把大项目拆成更多 issue，而是区分三种状态：

- **destination**：本轮探索要抵达的可观察终点，先于 ticket 存在；
- **frontier**：当前已经能精确表述、未阻塞、未认领的问题；
- **fog**：知道以后可能要处理，但现在还不能把问题说准的范围。

它的判定不是“现在能不能回答”，而是“现在能不能把问题精确说出来”。解决一个 decision ticket 后，新的可知范围才从 fog 进入 frontier；地图只保存低分辨率索引和决策指针，细节留在 ticket。

对 dteam 的启发不是引入 issue graph（问题图），而是：

> `dteam_dispatch` 只应接收当前已经清晰、自包含、可验证的 frontier；尚不能精确描述的 fog 留给主代理继续理解，不预先伪装成 worker task（工作者任务）。

Wayfinder 还区分 HITL（人参与）与 AFK（代理独立）ticket。Research（研究）可以并行，但 Grilling（追问）不能由 agent 代替用户回答。这提示 dteam：**预期中的用户决策不应被派给 worker；只有执行中意外暴露的决策缺口，才经 `request_decision` 回到主代理 / 用户。**

### 3.2 Ponytail：T3 探测不只找“改哪里”，还应找“是否不用改”

Ponytail 的 ladder（梯子）按固定搜索优先级停止在第一个能承载目标的层级：

1. 是否根本不需要存在；
2. 当前代码库是否已有；
3. 标准库是否已有；
4. 原生平台是否已有；
5. 已安装依赖是否已有；
6. 是否一行即可；
7. 最后才写最小实现。

它明确要求先理解真实调用流，再做减法；信任边界校验、数据保护、安全、无障碍和用户明确要求不能被简化掉。其 agentic benchmark 的有效信号也主要来自“原生能力替代自建组件”：date picker（日期选择器）和 color picker（颜色选择器）有巨大缩减，而不可再约简的 CRUD（增删改查）任务基本持平。

这给 ADR 0014 的新解释是：

> T3-first code reconnaissance（T3 优先代码探测）不应只定位入口、调用链和测试；在存在过度实现风险时，还应先收集“已有 / 标准库 / 原生 / 已装依赖能否承载”的事实，由主代理决定是否根本不进入实现路由。

不能把完整 Ponytail prompt 注入所有 T3：它会增加固定上下文，而且小模型未必能稳定执行七级判断。更轻的方式是由主代理把某一级问题写成有界探测任务，例如“核对仓库与现有依赖是否已经提供 X，只报告证据，不设计新实现”。

### 3.3 Critical → Fetch → Deep → Review → Loop：阶段名的价值在输入输出合同

Meta Skill Creator 的 README 用 `Critical Thinking → Fetch → Deep Thinking → Review → Loop` 表达方法；真实 `SKILL.md` 在中间还有 Build（构建）。可迁移价值不在阶段名，而在每段都有可见合同：

- **Critical Thinking**：明确任务类型、用户结果、范围、非目标、风险和第一证据路线；
- **Fetch**：只取会改变方案、工具路线或验收标准的证据，并记录反证、不可得路径和 decision impact（决策影响）；
- **Deep Thinking**：把证据综合成最小合同与验收计划，不继续无界搜集；
- **Build**：每个新增文件或规则必须对应一个具体失败模式；
- **Review**：区分 Structure / Contract / Artifact / Runtime / Human（结构 / 契约 / 产物 / 运行 / 人工）证明层级；
- **Loop**：只允许 `writeback / proposal / none-with-reason / blocked`（写回 / 提案 / 有理由不写回 / 阻塞）四类结论，聊天总结不等于闭环。

对 dteam 最直接的启发：worker 的 `claim / evidence`（主张 / 证据）不应只回答“发现了什么”，主代理还要回答“这条证据改变了哪个路由判断”；fresh verification（新鲜验证）也不应只说 pass（通过），而要说明证明的是 diff（差异）、build、测试行为、需求覆盖还是人工体验，不能跨层过度声称完成。

### 3.4 Superpowers 与 Spec Kit：固定流程提高可靠性，也制造上下文与适配成本

Superpowers 通过强制设计批准、详细计划、每任务 fresh implementer（新鲜实现者）、spec review（规格审查）、code quality review（代码质量审查）和完成前新鲜验证，提高了一致性。Spec Kit 则把 `spec → plan → tasks → implement → converge`（规格→计划→任务→实施→收敛）做成可重复 artifact chain（产物链），并用 flow-back / flow-forward / living spec 处理变更。

这些系统证明：

- 任务边界应小到能被 fresh reviewer（新鲜审查者）独立拒绝；
- 规格、计划与实现漂移需要显式 reconcile（对齐）；
- 长任务需要低分辨率索引和当前切片，而不是每轮重读完整计划；
- 完成声明必须来自本轮新鲜证据。

但它们也提供反例：所有任务走同一硬门、硬编码 artifact 路径、单体计划和过细步骤会增加成本。dteam 不应复制完整流水线，只应借“任务必须可独立验证”“证据必须新鲜”“实现发现可回流主代理”三条。

### 3.5 Anthropic、OpenAI 与 12-Factor Agents：动态路由必须可测、可中断、上下文最小

几组一手资料形成共同约束：

- Anthropic：从最简单模式开始；orchestrator-workers 适合无法预知子任务的复杂工作，但复杂度必须有可测收益；
- Anthropic Context Engineering：只给 subagent 最小高信号上下文，使用路径 / 链接 / 标识符按需放大；
- OpenAI：先以最强模型建立质量 baseline（基线），再用小模型替换，不能先假设小模型足够；
- 12-Factor Agents：LLM 只输出结构化下一步，确定性代码掌握暂停、恢复、审批、错误压缩和退出；agent 应小而聚焦。

这些结论同时印证 dteam 的 bounded handoff（有界交接）、结构化工具、主代理 owner（所有者）和 Worker Manager 不做路由，也要求 dteam 用真实 eval（评测）证明 T3-first 的整体收益。

## 4. 重新阅读 dteam 的已推翻决策

外部参考没有证明旧机制应该原样复活；它们说明某些机制可能不是“错误”，而是曾被放在错误层级或做得过重。

| 历史机制 | 当时为什么失败 / 被拒 | 新证据带来的重新解释 | 当前判断 |
|---|---|---|---|
| ADR 0005 Orchestrator Loop | 独立 loop 每轮决定召唤谁，长出重型编排与 Signal Store | Critical / Fetch / Deep / Review 可作为**主代理的每轮判断合同**，不必成为 runtime（运行时）状态机 | 可在主代理协议层重新表达；不复活 Manager loop |
| ADR 0005 “召唤轨迹即计划” | 没有确定锚点，下一步难解释 | Wayfinder 的 frontier / fog 允许“不穷举计划”同时保留当前可知边界 | 借 frontier 原则；不建 dteam 依赖图 |
| ADR 0005 Signal Store + TTL | 信号衰减驱动下一轮派发，事实与编排耦合 | 当前 append-only Signal Log + structured report（结构化报告）已能保存事实；下一步应由主代理解释 decision impact | 现役结构足够，不恢复 TTL / 分数 |
| ADR 0006/0007 对抗回合与积分制 | 固定多轮、角色与分数成本过高，原型“繁琐无用” | Review 的价值来自证明层级和反证，不要求多方案积分；fresh check 已成功移层复活 | 不恢复对抗角色 / 积分；强化证据边界 |
| Completion Gate（完成闸门） | 每次强制 check 过重 | Superpowers 证明 fresh evidence（新鲜证据）重要，但 Ponytail 证明额外流程只在有风险空间时有收益 | 保持风险驱动、最低足够档位验证，不做全局强门 |
| ADR 0004 不做 resume | worker 执行恢复会引入幂等、一致性与回滚复杂度 | Wayfinder / Spec Kit 证明**耐久决策地图**与**恢复执行 session**是两件事 | 不做 worker resume；允许外部 issue / spec / dgoal plan 承载耐久上下文 |
| ADR 0010 不保存 batch / 依赖图 | 避免 Worker Manager 变成导演 | Wayfinder frontier 可由主代理或外部 tracker 维护，dteam 只消费当前 ready（就绪）任务 | 决策继续有效；补充“外部地图兼容”即可 |
| ADR 0014 T3-first | 让 T1 不做低价值仓库探测 | Ponytail 扩展了“低价值探测”的定义：先找无需实现 / 复用 / 原生路径；OpenAI 同时要求强模型基线 | 候选成立，但必须先 benchmark，不能直接扩 prompt |

这里最重要的演进原则是：

> **允许有效零件移层复活，但不允许借新概念把旧系统整体复活。**

fresh check 已从失败的对抗式合议中移到验收层；同理，frontier 可移到主代理路由层，Loop 可移到结果后的决策合同，耐久地图可移到外部项目工件，而不是回到 Worker Manager。

## 5. 与 dteam 的三档关系

### 5.1 设计冲突（明确不借）

1. **不把 Wayfinder map、child issue、blocking graph 或 claim 状态放入 Worker Manager。** 这会直接违反 ADR 0010，并重新长出 batch / dependency scheduler（依赖调度器）。
2. **不恢复跨进程 worker resume。** 外部耐久决策工件不能被偷换成旧 AgentSession（代理会话）恢复。
3. **不把 Critical / Fetch / Deep / Build / Review 固化成每个任务必走的 runtime pipeline（运行时流水线）。** 简单任务与已有明确证据的任务应能跳过不必要步骤。
4. **不把完整 Ponytail / Superpowers prompt 注入所有 worker。** 当前 worker Logical Isolation（逻辑隔离）故意不加载 skills；固定注入会增加 token 成本，并可能超过 T3 的指令跟随能力。
5. **不恢复五角色、对抗回合、积分制或多方案 voting（投票）。** 新资料支持证据与验证，不支持这些已被真实原型否定的整体机制。
6. **不让 worker 决定自身升级或下一轮任务。** Decision impact 由主代理解释，`dteam_report` 不应新增 `suggestedTier`。

### 5.2 同思路（已有，印证方向）

| 外部机制 | dteam 现役对应 |
|---|---|
| Map 是索引、按需 zoom（放大） | bounded handoff 只传事实、约束、不确定性与来源，不传 transcript（逐字记录） |
| Fetch 后再综合 | ADR 0014 的 T3 探测 + 主代理综合 |
| 小而聚焦的 agent | 每个 worker 是 fresh、自包含、有限工具 / 时间 / 调用额度 |
| Structured next step（结构化下一步） | 五个公开工具 + `dteam_signal` / `dteam_report`，不用自由文本解析控制流 |
| Own control flow（掌握控制流） | 主代理决定 dispatch / respond / control / recover / wait；Manager 只执行 |
| Fresh evidence before claims | ADR 0016 的递增成本 fresh verification |
| 运行中发现回到决策者 | `request_context`、`request_decision`、`blocked` 与 `dteam_respond` |
| 错误紧凑化后 fresh 恢复 | timeout diagnostic（超时诊断）+ 裁剪恢复摘要，不 resume 旧 session |
| 不把所有学习写回 | 项目“术语表 / 决策档案 / 经验笔记”分流与准入门槛 |

### 5.3 候选（值得吸收）

#### 候选 A：派发前只识别当前 frontier

- **真实失败假设**：主代理把尚未说清的产品决策或未来依赖提前伪装成 worker task，worker 只能猜测、请求决策或产出低价值报告。
- **吸收方式**：在 `doc/10-架构与运行/14-dteam触发协议.md` 增加一条 readiness（就绪）判断：任务是否已经能写成自包含问题、验收是否可描述、是否仍含只能由用户决定的分支。fog 不进入 dispatch。
- **可能落点**：先改协议和 `index.ts` 的 `toolDescription`；不增加 schema、状态或 task type（任务类型）。
- **验证**：建立含模糊产品决策、可查且无阻塞的事实、明确且无阻塞的实现、问题已精确但前置条件未完成四类 prompt 的路由 eval；预期只派发中间两类，第一类返回用户决策，第四类保留为 blocked（阻塞）而不提前派发。

#### 候选 B：把 T3-first 从“定位代码”扩展为“定位最小承载路径”

- **真实失败假设**：T3 能找到修改入口，但没有检查现有实现、标准库、原生平台和已安装依赖，导致 T2 正确地实现了一个不需要存在的方案。
- **吸收方式**：仅在存在依赖、组件、抽象或重复实现风险时，主代理先派有界 reuse reconnaissance（复用探测）；主代理决定是否停止在零代码 / 复用路径。
- **可能落点**：`doc/10-架构与运行/14-dteam触发协议.md`、`doc/10-架构与运行/12-API参考.md` 的任务示例；如果评测证明稳定，再考虑新 ADR 修订 ADR 0014 的默认探测目标。暂不改 `src/session/tier-config.ts`。
- **验证**：以“仓内已有 / 标准库可替代 / 原生能力可替代 / 已安装依赖可替代 / 不可约简”五组任务，对比普通 T3 探测与复用探测的最终 LOC（代码行）、新依赖数、正确率、总 token 和延迟。

#### 候选 C：验证任务显式声明“要证明什么”

- **真实失败假设**：fresh worker 跑过 build 或测试后，把局部机械证据外推成“需求全部达标”。
- **吸收方式**：每个 verification task（验证任务）在 task 文本中声明 claim（待证明主张）、admissible evidence（可接受证据）和 limitation（证明边界）；报告仍使用现有 `claim / evidence / uncertainties`。
- **可能落点**：`doc/10-架构与运行/12-API参考.md` 和 `doc/10-架构与运行/10-系统架构.md`。只有出现反复误报后，才评估在 `src/runtime/types.ts` / `report-tool.ts` 增加 evidence kind（证据类型），不提前扩 schema。
- **验证**：准备“build 通过但行为失败”“单测通过但端到端失败”“运行通过但需人工体验确认”三类案例，检查报告是否越级声称完成。

#### 候选 D：显式化主代理的结果后路由决定

- **真实失败假设**：worker report 被收集后，下一步主要依赖主模型临场习惯；同样证据可能有时收口、有时继续搜、有时直接升档。
- **吸收方式**：不建 Manager loop，只在主代理协议中要求每轮结果后选择：`close / fetch-more / retry-or-escalate / ask-human / record-reusable-learning`（收口 / 继续取证 / 重试或升级 / 请求人类决策 / 记录可复用学习）。
- **可能落点**：`doc/10-架构与运行/10-系统架构.md` 的主代理运行图、`14-dteam触发协议.md` 的结果后自检。
- **验证**：先为固定 report fixture（报告样本）标注预期动作，作为 routing oracle（路由判定器）：证据充分无冲突=`close`、关键事实缺失=`fetch-more`、同档执行失败且边界不变=`retry`、低档能力不足=`escalate`、用户所有权决策=`ask-human`、重复可复用经验=`record-reusable-learning`。回放时固定模型、主代理 prompt、可用工具和 report 内容，每个 fixture 重复多次，以动作匹配率和不一致原因判定，而不是只观察“看起来合理”。

#### 候选 E：允许外部耐久地图，但不建立 dteam 持久运行态

- **真实失败假设**：跨会话大型项目既不能放进一次 dteam，也因“不做 resume”被误解为不能引用任何耐久决策工件。
- **吸收方式**：明确 dteam worker 可以消费主代理传入的 issue / PRD / dgoal plan（计划）中的当前 slice（切片）与 evidence pointer（证据指针），并回传结构化事实；dteam 不保存外部 ID 映射，也不恢复 worker。
- **可能落点**：`doc/10-架构与运行/14-dteam触发协议.md` 的 dgoal / 外部计划协作说明、路线图中原本待定的 dgoal 同会话配合。
- **验证**：用一个跨会话探索项目检查 fresh worker 是否只靠当前 slice + bounded handoff 即可工作；若必须恢复完整 session 才能成功，则本候选失败。

#### 候选 F：先建 routing benchmark，再改变定位或默认路由

- **真实问题**：当前项目有 runtime（运行时）单测，但没有比较“主模型直接做、T3-first、T2 直接做、T3→T2 升级”的任务质量 / 成本基准。核心价值主张仍主要来自经验判断。
- **吸收方式**：建立固定任务集，至少包含机械查找、仓内复用、标准库 / 原生 / 已装依赖替代、常规实现、复杂判断、验证越级六类；每个 fixture 固定仓库 commit、任务输入、可用工具、验收 oracle（判定器）和最高允许改动范围。对比 `T1 direct`、`T2 direct`、`T3-first` 与 `T3→T2`，保持除路由策略外的 prompt、工具和验收一致，每格多次 fresh run（新鲜运行）。记录成功率、总耗时、总 token / 成本、worker 数、升级率、重复探索和用户纠正次数，并单独报告无法自动判定的人工层结果。
- **可能落点**：未来新建 `benchmarks/README.md` 与最小 harness（评测工具）；需要 token / usage（使用量）数据时再评估 `src/runtime/worker-manager.ts` 的可观察性扩展。路线图先记录评测，不先改路由代码。
- **反证要求**：遵循 OpenAI 的 strong-model baseline（强模型基线）；若 T3-first 在同一 fixture 与控制条件下总成本更高、错误更多或常升级，则收窄触发，而不是解释性维护原结论。

## 6. 建议的验证顺序

按后续证伪与能力补齐优先级排序：

1. **P0：routing benchmark**——先知道 T3-first 在哪些任务上真的省、在哪些任务上只是增加往返。
2. **P1：复用探测 A/B**——验证 Ponytail ladder 中最可机械化的“仓内 / 标准库 / 原生 / 已装依赖”四层，不测试完整人格 prompt。
3. **P1：frontier readiness eval**——确认主代理能区分精确问题、可查事实与只能由人决定的分支。
4. **P1：proof-layer replay**——验证 fresh reviewer 不会用 build 通过代替需求 / 行为 / 人工层证明。
5. **P2：外部耐久地图试用**——先在真实长项目中试“外部地图 + 当前切片 + bounded handoff”，再讨论是否需要任何新接口。

任一实验若没有真实差异，就保持现状。尤其不要先增加 `taskType`、`proofLayer`、`frontierState`、`mapId` 或新的公开工具，再去寻找它们的用途。

## 7. 对定位的潜在影响

当前“模型分级路由执行层”仍成立，并已由 ADR 0020 正式补上主代理一侧：

```text
当前强调：
主代理拆任务 → dteam 按 T1/T2/T3 路由执行与验证

已采纳的协议：
主代理定义当前证据问题
→ T3 获取会改变决策的证据 / 核对最小承载路径
→ 主代理综合并选择最低足够执行档位
→ fresh worker 按明确证明层级验证
→ 主代理收口、继续取证、升级或请求人类决策
```

后续 `507-grill` 已回答这个难逆转问题：dteam 的正式定义包含“执行层 + 主代理证据驱动路由协议”，但协议是可由用户覆盖的默认，Worker Manager 不设置语义硬门。benchmark 继续负责发现哪些任务不适合 T3-first、多轮取证或复用探测，并触发后续 ADR 收窄。

## 8. 可继续精读的文件与资源

### Wayfinder

- [`skills/engineering/wayfinder/SKILL.md`](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/wayfinder/SKILL.md)
- [`docs/engineering/wayfinder.md`](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/docs/engineering/wayfinder.md)
- [`issue-tracker-github.md`](https://github.com/mattpocock/skills/blob/9603c1cc8118d08bc1b3bf34cf714f62178dea3b/skills/engineering/setup-matt-pocock-skills/issue-tracker-github.md)

### Ponytail

- [`skills/ponytail/SKILL.md`](https://github.com/DietrichGebert/ponytail/blob/16f29800fd2681bdf24f3eb4ccffe38be3baec6b/skills/ponytail/SKILL.md)
- [`skills/ponytail-review/SKILL.md`](https://github.com/DietrichGebert/ponytail/blob/16f29800fd2681bdf24f3eb4ccffe38be3baec6b/skills/ponytail-review/SKILL.md)
- [`benchmarks/results/2026-06-18-agentic.md`](https://github.com/DietrichGebert/ponytail/blob/16f29800fd2681bdf24f3eb4ccffe38be3baec6b/benchmarks/results/2026-06-18-agentic.md)
- [`benchmarks/results/2026-06-17-cost-verification.md`](https://github.com/DietrichGebert/ponytail/blob/16f29800fd2681bdf24f3eb4ccffe38be3baec6b/benchmarks/results/2026-06-17-cost-verification.md)

### Critical / Fetch / Deep / Review / Loop

- [`skills/meta-skill-creator/SKILL.md`](https://github.com/KimYx0207/meta-skill-creator/blob/acc7b8003ee4ea2304c2a70a4630c6d633dc5855/skills/meta-skill-creator/SKILL.md)
- [`creation-rule-standard.md`](https://github.com/KimYx0207/meta-skill-creator/blob/acc7b8003ee4ea2304c2a70a4630c6d633dc5855/skills/meta-skill-creator/references/creation-rule-standard.md)
- [`closed-loop-governance.md`](https://github.com/KimYx0207/meta-skill-creator/blob/acc7b8003ee4ea2304c2a70a4630c6d633dc5855/skills/meta-skill-creator/references/closed-loop-governance.md)

### 固定流程与替代架构

- [`obra/superpowers` brainstorming](https://github.com/obra/superpowers/blob/d884ae04edebef577e82ff7c4e143debd0bbec99/skills/brainstorming/SKILL.md)
- [`github/spec-kit` spec persistence](https://github.com/github/spec-kit/blob/7bdf6c50416c2e7ea96d8398b569a78808adc6e9/docs/concepts/spec-persistence.md)
- [`12-factor-agents` own your control flow](https://github.com/humanlayer/12-factor-agents/blob/d20c728368bf9c189d6d7aab704744decb6ec0cc/content/factor-08-own-your-control-flow.md)
- [Anthropic — Building effective agents](https://www.anthropic.com/engineering/building-effective-agents)
- [Anthropic — Effective context engineering for AI agents](https://www.anthropic.com/engineering/effective-context-engineering-for-ai-agents)
- [OpenAI — A practical guide to building agents](https://openai.com/business/guides-and-resources/a-practical-guide-to-building-ai-agents/)

## 9. 决策记录

调研当轮未直接新增 ADR；后续对齐与实施新增：

- [ADR 0020](../决策档案/0020-主代理证据驱动多轮路由协议.md)：扩展正式产品合同，采用多轮 T3、主代理选源 + T3 提取、外部耐久地图边界；
- [ADR 0021](../决策档案/0021-结构化工作报告区分动作完成度与验证深度.md)：统一报告为 outcome / activities / facts / verification / uncertainties，人工复测留在报告之外；
- 仍没有证据支持把轮次、外部地图、公开新工具或持久化状态写进 Worker Manager；
- routing benchmark、受限外部只读工具和外部耐久地图试点继续留在路线图，负责证伪与能力补齐。
