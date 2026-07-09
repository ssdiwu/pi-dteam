# 29-ZCode Swarm 蜂群插件参考

> 调研对象：`ashelylinluo/zcode-plugin-swarm`（ZCode 桌面版多 Agent 编排插件，MIT，v0.1.0）
> 一手源：插件发布包 `zcode-agent-teams-plugin.zip` 解压源码（skills/agents/src/lib/commands）+ `security-architecture-review-skill.md`
> 二手源：ZCode 用户交流群6 聊天记录（2026-07-06~07-09，仅作用户反馈/作者意图佐证）
> 对比坐标：[ADR 0008](../决策档案/0008-dteam重定位为模型分级路由执行层.md) 的 dteam 模型分级路由 + dgoal 单模型建检边界
> 调研日期：2026-07-09；按 0008 重评：2026-07-10

## 1. 总体判断（0008 坐标系）

**部分值得，价值在印证 dteam 的 coordinator（协调者）形态，不在复制 swarm（蜂群）架构。**

一手源码支持四个判断：

1. coordinator 强调“主 agent 绝不外包理解”，印证 dteam 的主模型（T1）必须是 owner，负责拆分、路由、综合和验收。
2. 并行增量价值集中在“大量独立可拆分的小任务”，印证 dteam 应作为按需启用的分级路由层，而不是并入 dgoal 的默认建检循环。
3. 红队 skill 的独立、证据驱动、只读审核，与 dteam fresh 验收 / dgoal_check 同源。
4. shared task list、竞争认领、文件邮箱和 P2P 通信是平台特定复杂度，dteam 不借。

群聊中“机械活用 flash 降智商”的实践反馈，直接印证 0008 的 T1/T2/T3 能力分级；但群聊声称的无脑单蜂、死路标记、分层部门和 skill 推荐并未出现在 v0.1.0 源码里，不作为已实现机制。

## 2. 核心机制速览（一手）

### 2.1 两种编排模式

| | Coordinator（星型） | Swarm（团队 + 竞争） |
|---|---|---|
| 拓扑 | 主 agent 居中，worker 外围 | lead 协调 + teammate 间可经 mailbox 直连 |
| 任务分配 | 主 agent 综合后主动派发 | teammate 从共享列表竞争认领（文件锁原子） |
| 通信 | ZCode 内置 SendMessage（lead→worker 续传） | 文件邮箱 + 共享任务列表 |
| 子 agent | 全套标准工具，自主执行 | 全套工具 + swarm MCP 工具 |
| 适用 | 集中综合决策、任务有依赖 | 任务独立、可完全并行 |

### 2.2 Swarm 并行原语（`src/lib/taskList.ts`）

- **共享任务列表**：`~/.zcode/tasks/{team}/{id}.json`，每任务一文件。
- **`blockedBy` 依赖图**：Task 有 `blockedBy` + `blocks`；认领前检查依赖完成。与 dgoal task plan 数据模型高度同构。
- **`claimTask` 文件锁认领**：proper-lockfile 锁单个 task 文件，避免多个 teammate 抢同一任务。
- **`claimTaskWithBusyCheck`**：单 agent 一次只持有一个 in_progress 任务。
- **源头是 Claude Code**：文件头注明“Ported from Claude Code `src/utils/tasks.ts`, trimmed for ZCode”。

### 2.3 Coordinator 核心纪律（`skills/coordinator/SKILL.md`）

最值得借的是主 agent 的综合责任：

> 当 worker 报告研究发现时，你必须先自己理解，再派发后续工作。你绝不把理解外包。

skill 还用“上下文重叠度”决定续传还是新开：研究与实现文件高度重叠可续传；验证别人写的代码或第一次走错方向应新开，以获得 fresh perspective（新鲜视角）。

### 2.4 红队 skill（`security-architecture-review-skill.md`）

独立对抗性审查 prompt：基于真实 `git diff`，证据优先、禁止臆测、禁止把未运行测试写成通过；只读红线；P0-P3 分级。与 dteam fresh 验收、dgoal_check 的“独立 + 证据驱动 + 不让学生判卷”原则同源，但范围更偏全栈安全审查。

## 3. 一手源与群聊口述的重大出入

| 群聊口述（二手设想） | 插件 v0.1.0（一手） |
|---|---|
| 单蜂不思考，只带眼睛和手，不停请求战术指导 | teammate 是自主执行单元：全套工具，要求主动调查并修根因 |
| 死路标记 + 排除法收敛 | task 只有 `pending/in_progress/completed`，无死路状态 |
| 一级部门 / 二级部门 | 扁平一层 team + teammate，无层级 |
| lead 每次推荐 5 个 skill | 源码无此机制 |
| 战术指导回路 | 实际是 mailbox / SendMessage 续传 |

**结论**：群聊描述的是未来设想，不是已实现代码。机制判断以一手源码为准。

二手信息仍提供了有效的产品反馈：
- 真实用途集中在重大重构、批量基础任务、短期拉起骨架；
- 用户普遍认为成本高，作者提出“机械活用 flash”降成本；
- lead 会出现上下文膨胀，作者考虑借 auto Dream 做压缩和召回。

## 4. 对 dteam 0008 的具体启发

### 4.1 明确吸收

- **主模型 owner，不外包理解**：T1 必须自己理解 worker 结果后再路由/综合，不能把 worker 摘要原样转交给下一个 worker。
- **集中派发而非竞争认领**：dteam 采用主模型主动 `dteam_dispatch`，对应 coordinator 星型，而非 swarm 抢单。
- **低档模型做机械活**：群聊的 flash 实践印证 T3 快速档的真实价值。
- **fresh 验收**：验证别人刚写的产出要新开 session；红队 prompt 可作为 T1 只读验收的严格度参考。

### 4.2 明确不借

- **共享 task list / `blockedBy`**：这是 dgoal 的 task plan 能力；dteam 不维护独立计划。
- **竞争认领 + 文件锁**：dteam 由主模型判断任务独立性并主动 fan-out，不让 worker 抢单。
- **mailbox P2P 通信**：worker 无需互相通信，结果回主模型综合。
- **多层团队 / 液态拓扑**：没有真实痛点，不引入。

### 4.3 并行边界

并行只在“多个小任务相互独立”时创造明显价值；代价包括成本、主模型上下文膨胀、文件写冲突和协调复杂度。这个窄边界解释了为什么：

- dgoal 保持单模型建检，不默认承担并行复杂度；
- dteam 独立存在，按需提供多模型分级 fan-out；
- 强依赖任务仍由主模型或 dgoal 串行推进。

## 5. 并行代价（相对 dgoal 单模型基线）

| 代价 | 证据 | 0008 应对 |
|---|---|---|
| 成本爆炸 | 群聊普遍反馈贵；插件说明 token 紧张时不推荐 | 机械活路由 T3，关键思考留 T1 |
| 主模型上下文膨胀 | coordinator 强调综合责任；作者考虑 auto Dream | worker task 自包含、结果回主模型；不加 P2P 消息层 |
| 文件写冲突 | coordinator 规定同组文件一次只一个 worker | 主模型只并行文件边界独立的小任务 |
| 编排复杂度 | 续传/新开/综合规则本身很重 | 单工具 dispatch，不建共享队列或独立 Orchestrator Loop |

## 6. 可借鉴文件

| 文件 | 价值 | dteam 用法 |
|---|---|---|
| `skills/coordinator/SKILL.md` | “绝不外包理解” + 续传/新开判断 | T1 路由与综合 prompt 参考 |
| `security-architecture-review-skill.md` | 证据优先 + 只读红线 + 严重度分级 | fresh 验收 prompt 参考 |
| `src/lib/taskList.ts` | blockedBy + 原子认领的一手实现 | 仅用于印证 dgoal task plan；dteam 不引入 |
| `skills/swarm/SKILL.md` | 竞争认领完整流程 | 反例参考，明确不借 |

## 7. 决策记录

本调研不单独新增 ADR，但它是 ADR 0008 的外部依据之一：

- coordinator 印证“主模型 owner + 主动派发”；
- flash 实践印证模型档位；
- 红队印证 fresh 验收；
- swarm 的成本与复杂度反证 dteam 应保持单工具、按需启用。

## 8. 实施阶段可回看

进入 0.7.0 dgoal 实施时，只回看三个具体点：

1. T1 system prompt 加“绝不外包理解”；
2. T3 默认低思考 + 受限工具，机械活优先；
3. fresh 验收 prompt 加“证据优先、未运行测试不得声称通过、只读红线”。

不实现共享队列、竞争认领、mailbox、层级团队或 dgoal 并行化。
