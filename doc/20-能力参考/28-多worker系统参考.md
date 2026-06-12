# 多 worker 系统参考：SwarmFlow / MiMo Code / pi-subagents

> 调研目的：不是照搬多 agents（多代理）数量，也不是替换 dteam 当前写死角色；而是学习别人如何处理 **多 worker 协作关系、后台可观测性、边界安全、自然语言可用性**。

## 1. 结论

| 系统 | 核心做法 | dteam 借鉴 |
|---|---|---|
| SwarmFlow（openJiuwen） | 把“编排”和“智能”分开；确定流程才写成 workflow | 借“协作关系可控”的原则，不照搬 workflow.py |
| MiMo Code | 长程任务靠计算、记忆、演进三层；Dynamic Workflow 把编排写成代码 | 借 verifier / writer 这类旁路角色思想，不做固定流水线 |
| pi-subagents | 自然语言委托、foreground/background、async widget、child safety、doctor、prompt shortcuts | 借产品体验和安全边界，不借角色可配置体系 |

一句话：**多 worker 的价值不在“多”，而在协作关系清楚、状态可见、边界安全、结束条件可信。**

## 2. SwarmFlow：编排和智能分离

SwarmFlow 的关键判断：

> 谁先做、谁并行、谁把结果交给谁、失败怎么处理 —— 这些是编排，应该由系统稳定执行；每个节点怎么理解和推理 —— 才交给 Agent。

### 2.1 两类协作

| 类型 | 适合场景 | 处理方式 |
|---|---|---|
| 开放协作 | 圆桌讨论、方案评审、战略研讨 | 保留动态协商，不写死流程 |
| 确定编排 | 批量论文分析、固定报告生成、批量 PPT | 写成可执行 workflow |

### 2.2 对 dteam 的启发

- dteam 不应把所有复杂任务都变成固定流水线。
- dteam 可以在 planner 输出里让“并行 / 串行 / 汇总”更清楚。
- dteam 的 UI 应展示“现在处于哪个协作阶段、哪些 worker 在跑、哪些已经完成”。
- 确定性来自运行时调度，而不是让一个 leader agent 每轮临场记住所有流程。

### 2.3 不借的部分

- 不引入 `workflow.py`
- 不做可视化 workflow 编辑器
- 不把 dteam 变成通用工作流平台

## 3. MiMo Code：长程任务的旁路机制

MiMo Code 关注的是 long-horizon（长程）编程任务。它把问题拆成：

| 主题 | 解决的问题 |
|---|---|
| Computation（计算） | 单步决策质量下降 |
| Memory（记忆） | 长 session（会话）状态连续性 |
| Evolution（演进） | 跨 session 经验沉淀 |

### 3.1 值得关注的机制

| 机制 | 做法 | dteam 态度 |
|---|---|---|
| Max Mode | 同一步生成多个候选，再 judge（评审）选择 | 暂不做，token 成本太高 |
| Goal Verifier | agent 想结束时，独立 verifier 检查目标是否满足 | 远期可借，作为可选策略 |
| Dynamic Workflow | 主 agent 生成脚本，用 `agent()` / `parallel()` / `pipeline()` 调度 | 借“编排结构化”思想，不写脚本 API |
| Checkpoint Writer | 独立 writer subagent 写结构化状态，主 agent 不自己记笔记 | 远期参考 |
| Dream / Distill | 周期性整理记忆与工作流 | 暂不做，过重 |

### 3.2 对 dteam 的启发

- 主 worker 不应该同时承担“实现、记忆、验证、调度”所有职责。
- 结束条件如果痛点明显，可以加轻量 verifier，而不是固定 6 阶段流水线。
- 记忆如果痛点明显，优先考虑旁路 writer，而不是让 build 自己维护复杂笔记。

## 4. pi-subagents：产品体验和安全边界

来源：`https://pi.dev/packages/pi-subagents`，版本参考 0.25.0。

### 4.1 值得学习的产品表达

| pi-subagents 做法 | 价值 | dteam 借鉴方式 |
|---|---|---|
| “Try this first” 自然语言示例 | 用户不用先懂命令 | dteam README / API 文档补“什么时候该调 dteam” |
| Foreground / Background 区分 | 用户知道控制权是否返回 | dteam 已选择后台；文档持续强调 |
| async widget + completion notification | 后台任务可见 | dteam 已有 widget / report，0.5 优先打磨 |
| status tree（状态树） | 并行 / nested run 不隐藏 | dteam `/dteam` 面板继续强化 worker 树 |
| doctor（诊断命令） | 配置错误可自查 | 远期参考，不是 0.5 必须 |
| prompt shortcuts（提示词快捷方式） | 常见工作流可复用 | 可写文档示例，不一定实现 slash prompt |
| child-safety boundaries | 子 agent 不应自动获得父级编排权 | dteam 继续保持单工具、角色权限隔离 |

### 4.2 明确不借的部分

| 不借 | 原因 |
|---|---|
| 自定义 agent / chain 文件体系 | dteam 当前 5 角色写死更稳定 |
| 大量 slash commands（斜杠命令） | dteam 保持 1 个工具 + 1 个 `/dteam` 命令 |
| nested subagent fanout | dteam 当前不做递归 spawn |
| forked child context 体系 | dteam 当前 in-process，默认 fresh context |
| intercom companion | dteam 已有 SignalBus + continue，先不加依赖 |

### 4.3 具体可借的轻动作

1. 文档补“普通自然语言请求怎么触发 dteam”。
2. UI 上区分“正在跑 / 等用户 / 已完成 / 已失败”。
3. 完成报告保持 grouped（分组）结构，不把 parallel worker 混成假 chain。
4. 如后续加 `status` action，要保持只读，不改变 run。
5. 如果加诊断，先做 `/dteam doctor` 的只读检查，不引入复杂修复。

## 5. 对 dteam 0.5 的约束

0.5 的起点应是：

> **提升多 worker 协作的可观测性和用户理解成本，而不是引入固定流水线或开放角色系统。**

因此 0.5 优先：

- `/dteam` 面板状态更清楚
- 完成项不堆积
- report 更像 worker tree
- 文档告诉主 LLM / 用户何时调 dteam
- 保持后台运行稳定性

0.5 暂不做：

- 固定 6 阶段流水线
- workflow 脚本
- Max Mode
- Dream / Distill
- 自定义角色市场
- 进程级隔离
