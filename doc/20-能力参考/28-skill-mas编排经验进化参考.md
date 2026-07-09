# 28-Skill-MAS 编排经验进化参考

> 调研对象：Skill-MAS: Evolving Meta-Skill for Automatic Multi-Agent Systems（arXiv:2606.18837，蚂蚁集团 + 港科广，2026-06）
> 借鉴目的：判断“编排经验自动进化”对 dteam 有没有启发。
> 调研日期：2026-07-08；按 [ADR 0008](../决策档案/0008-dteam重定位为模型分级路由执行层.md) 重评：2026-07-10。

## 1. 总体判断（0008 坐标系）

**高质量，但核心路线不适用。**

Skill-MAS 解决的是“编排经验如何跨任务复用并自动进化”；dteam 0008 解决的是“如何把当前任务按模型能力档位路由，避免强模型做机械小活”。前者需要可持久化的 Meta-Skill、整条任务多轨迹采样和持续优化器，后者刻意保持 task-local（单任务内）、单工具 dispatch、无 resume。

因此：

- **不借**：跨任务 Meta-Skill 持久化、动态生成整套多 agent 工作流、K=5 整任务轨迹采样。
- **已有印证**：Task Decomposition / Agent Engineering（任务拆分/代理工程）说明“任务难度 → 执行能力”的路由是独立问题；Selective Reflection（选择性反思）支持“只对关键结果做 fresh 验收”，而非每个 dispatch 都强制复核。
- **不产生新实现候选**：0008 的 T1/T2/T3 + 可选 fresh 验收已经覆盖能吸收的轻量部分。

## 2. 核心机制速览

1. **编排能力 = 可进化的 Meta-Skill**：把高层编排能力写成可读、可改的文档，靠文本迭代而非梯度更新来“学习”。
2. **Meta-Skill 三模块**：Task Decomposition（任务怎么拆）/ Agent Engineering（谁来做）/ Workflow Orchestration（工作流怎么连）。
3. **Multi-Trajectory Rollout（多轨迹展开）**：同一验证任务默认采样 K=5 条执行轨迹，以得分均值 + 波动判断问题来自能力还是规则不明确。
4. **Selective Reflection（选择性反思）**：按 uncertainty（不确定性）和 difficulty（难度）筛选高价值任务，对高低分轨迹做对比分析，提炼 evidence package（证据包）。
5. **Skill Optimizer（技能优化器）**：仅根据证据包修改相关模块，并要求抽象成通用编排原则，禁止单题补丁。
6. **迁移证据**：同任务同模型提升最大；换模型或换任务后收益衰减；跨模型且跨任务最弱但仍为正。

## 3. 与 dteam 0008 的关系

> 当前坐标系：dteam = **模型分级路由执行层**；主模型（T1）负责思考/路由/验收，小任务 fan-out 给 T3，难任务回退 T1。运行时不维护独立 task plan，不跨任务持久化编排经验（ADR 0004）。

### 3.1 设计冲突（明确不借）

**① Meta-Skill 跨任务进化——与 ADR 0004 和轻量 dispatch 冲突**

dteam 不跨任务积累编排策略。引入可持续改写的 Meta-Skill，意味着新增持久化、版本治理和经验污染控制，超出模型分级路由执行层边界。

**② 动态生成完整工作流——会重新造回被 0008 砍掉的编排层**

0008 让主模型在现有对话里直接做路由，dteam 只负责 dispatch 执行。若再引入 Task Decomposition / Agent Engineering / Workflow Orchestration 的持续生成器，就等于重新建立 planner + Orchestrator + 持久经验层。

**③ K=5 整任务轨迹采样——成本模型不兼容**

dteam 并行的是多个独立小任务，不是把同一个完整目标跑五遍。整任务多轨迹会把成本放大一个数量级，违背“用小模型降本加速”的核心价值。

### 3.2 同思路（已有印证）

- **任务拆分和执行能力应分开表达**：Skill-MAS 把 Task Decomposition 与 Agent Engineering 分开，印证 dteam 应由主模型先判断任务独立性/难度，再选择 T1/T2/T3，而不是把“角色”继续定义成探索/设计/实现职能。
- **选择性验证优于全量强制验证**：Selective Reflection 只处理高价值不确定项，支持 0008 的 fresh 验收默认可选；关键 task 才调 T1 fresh worker。
- **迁移收益随上下文距离衰减**：越跨任务、跨模型，Meta-Skill 收益越弱，反向支持 dteam 不为尚未出现的重复痛点建立跨任务经验层。

### 3.3 候选结论

**无新增候选。** 能吸收的轻量部分已由 0008 的“主模型路由 + 三档模型 + 可选 fresh 验收”承载；其余核心能力均要求 dteam 扩张为持续进化的编排平台，明确不做。

## 4. 赛道定位

Skill-MAS 属于“编排/技能经验自动进化与复用”赛道：

| 工作 | 关注点 | 与 Skill-MAS 的分工 |
|---|---|---|
| **MUSE-Autoskill**（arXiv:2605.27366） | 技能全生命周期：创建、存储复用、组织选择、评估 | 技能资产治理 |
| **SkillMAS**（ResearchGate） | skill 与 MAS 共进化、非参数化专业化 | 技能与多代理协同进化 |
| **OFA-MAS / MASPO** | 协作图生成 / 提示词协作信用分配 | 仅见 Skill-MAS 论文自述，未独立核实一手源 |

**反例**：OpenReview《When Single-Agent with Skills Replace Multi-Agent Systems》认为单 agent + skills 编译可替代部分多 agent 架构，并有运行时效率优势。它支持 dteam 的克制边界：不追求通用多 agent 平台。

> 一手源说明：Skill-MAS 机制取自 arXiv 摘要 + 507 提供的结构化总结（已对照摘要）。MUSE-Autoskill / SkillMAS 经搜索确认存在；OFA-MAS / MASPO 未追一手。

## 5. 可借鉴资源

- **arXiv:2606.18837**：重点看 Multi-Trajectory Rollout 与 Selective Reflection 的形式化定义。
- **arXiv:2605.27366**（MUSE-Autoskill）：若未来出现真实的技能资产生命周期痛点，再作为对照。
- **OpenReview kym0qvjrvm**（When Single-Agent with Skills Replace MAS）：轻量化反例。

## 6. 决策记录

本调研**不单独产生 ADR**。按 0008 重评后，结论由现有决策覆盖：

- ADR 0004：不做 resume / 默认持久化；
- ADR 0008：dteam 是 task-local 的模型分级路由执行层，不恢复独立编排循环。

## 7. 何时重开

仅当同类任务至少三次证明“模型档位和路由经验需要跨任务复用”，且人工维护配置已成为真实成本时，再重评 Meta-Skill。届时先回答是否推翻 ADR 0004；在此之前不引入经验进化层。
