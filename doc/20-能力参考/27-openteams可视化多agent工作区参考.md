# 27-OpenTeams 可视化多 agent 工作区参考

> 调研对象：[`openteams-lab/openteams`](https://github.com/openteams-lab/openteams)（本地优先的多智能体协作工作区）  
> 主要来源：`readmes/README_zh-Hans.md`、仓库 `AGENTS.md`、`docs/OpenTeams-Technical-Documentation.md`、`docs/session-worktree-isolation-design.md`、`docs/agent-run-file-diff-display-report.md`  
> 调研日期：2026-06-26

## 1. 总体判断

**部分值得，主要启发在产品可控性与证据呈现，不在核心编排模型。**

OpenTeams 把多个 coding agent（编程代理）放进一个本地工作区，提供自由聊天和可视化 workflow graph（工作流图）两种模式。它解决的是“多 agent 工具窗口太多、执行过程不可见、失败步骤无法局部重试”的产品问题；而 dteam 0.6.0 解决的是 Pi 内“主 LLM 需要群策群力时，前台召唤固定五角色持续协作”的能力问题。

因此，OpenTeams 的核心 workflow graph、节点审批、持久化执行图、session worktree（会话隔离 Git 工作树）和多外部 agent runner 不能整体搬到 dteam。真正值得吸收的是三个轻动作：**让 dteam 的可观察信息更像“工作进度卡”而不是日志堆叠；把完成证据聚合成可审查的 artifact（产物）索引；在文档里强化“自由轻协作 vs 结构化可控执行”的触发解释**。

## 2. 核心机制速览

1. **Free Chat + Workflow 双模式**：轻任务用 `@agent` 自由聊天，复杂任务切到 Workflow mode，由 lead agent 澄清需求、生成可视化步骤、再按节点执行。
2. **Workflow graph 是执行真相**：计划存为 React Flow JSON，再由后端 compiler materialize（物化）成 executions / rounds / steps / edges / loops；运行态状态由 orchestrator reducer 统一写入。
3. **节点级控制**：每个 workflow step 有 `pending / ready / running / waiting_review / completed / failed` 等状态，支持暂停、输入、审批、拒绝、重试和重新指派。
4. **本地运行轨迹落盘**：运行记录保存在 `<workspace>/.openteams/` 和数据库中，包含 messages、run records、diff、logs、transcripts、workflow events。
5. **文件变更可审查**：每次 agent run 建 baseline，结束后捕获 delta，前端按 `run_id` 拉取结构化文件列表；目标是把 diff 和日志附到具体工作节点或消息。
6. **可选 session worktree 隔离**：复杂并发会话可在独立 Git worktree 中运行，最终通过 merge / discard 收口，避免不同 session 的文件变更混杂。

## 3. 与 dteam 的关系

### 3.1 设计冲突（明确不借）

- **Workflow graph 与 dteam 自发生长冲突**：OpenTeams 的 workflow mode 强调执行前可见计划、节点依赖、逐步审批；dteam ADR 0005 明确“无预先 Task Plan，召唤轨迹即计划”。把 React Flow 计划图搬进 dteam，会退回 0.5.0 已推翻的 planner 穷举路线。
- **持久化执行图与 No Default Resume 冲突**：OpenTeams 用数据库和 `.openteams/` 保存 workflow executions、events、transcripts；dteam 的 Signal Store 是单 goal 生命周期、TTL 衰减、不落项目目录。dteam 不做默认 resume，不引入长期 job database。
- **多外部 agent runner 与进程内 worker 冲突**：OpenTeams 连接 Claude Code / Codex / Gemini CLI / Qwen Code 等外部 runner；dteam 0.6.0 默认进程内 `AgentSession` + Logical Isolation，不默认 spawn OS 子进程。
- **可自定义团队/成员与固定五角色冲突**：OpenTeams 允许 session 添加成员、分配模型和角色、保存 preset team；dteam 固定 `explore/design/build/check/close`，不做角色市场。
- **逐节点人工审批与同步前台 loop 体验冲突**：OpenTeams 面向技术负责人控制每个节点；dteam 面向 Pi 主对话内的“群策群力工具”，用户感知粒度是开启 dteam → 完成工作 → check 收口，不把 worker 内部轮次暴露成审批流。
- **session worktree 不应内置进 dteam**：独立 worktree 是整个开发工作区的 source-control 能力，适合 OpenTeams 桌面产品；dteam 是 Pi extension，不应自己接管 Git worktree 生命周期。若 Pi 未来提供工作区隔离，应由上层 harness 承担，dteam 只消费结果。

### 3.2 同思路（已有，印证方向）

- **Lead / Orchestrator 先澄清再推进**：OpenTeams lead agent 在生成计划前澄清需求；dteam 由主 LLM 决定是否拉起 Orchestrator Loop，Orchestrator 每轮基于 Signal Store 做下一步召唤。两者都承认“多 agent 协作需要一个协调主体”。
- **可见执行是生产力关键**：OpenTeams 强调 status、diff、logs、blocked point；dteam 已有 Reporter、UIStore、`/dteam` panel、Live Loop View 和 Evidence 概念。方向一致，但粒度不同。
- **失败不应从头再来**：OpenTeams 支持只重试失败节点；dteam 通过 Signal Store 的 `blocked/help` 与 Orchestrator 继续召唤实现局部自愈，不需要恢复整张执行图。
- **产物和轨迹支撑验收**：OpenTeams 把 logs、diff、transcripts、artifact 附到工作上；dteam 的 Completion Gate 要求 `check` 基于召唤轨迹、worker 结果、Signal Store 快照和 validation result 收口。两者都反对“agent 说 done 就 done”。
- **本地优先与隐私意识**：OpenTeams 强调本地工作区运行；dteam 虽不承担桌面工作区，但 Logical Isolation、工具白名单、`build` 唯一可 edit 等边界同样是在降低协作风险。

### 3.3 候选（值得吸收）

- **工作进度卡式摘要（UI 轻增强）**：
  - 机制：OpenTeams 把每个 step 的状态、diff、日志、review 显示在 workflow graph/card 上。
  - dteam 改造点：`src/ui/panel.ts` 和 `src/ui/store.ts` 可把当前 `/dteam` panel 从 worker 列表进一步整理成三段摘要：当前 Orchestrator 判断、最近关键 signal、check 收口状态。
  - 边界：不展示 worker 内部 tool rounds，不做节点审批，不引入 workflow graph。只是让现有 Live Loop View 更像“进度卡”，符合术语表里用户感知粒度。

- **Evidence Bundle（证据包）索引**：
  - 机制：OpenTeams 把 logs、diff、transcripts、generated artifacts 附到 work 上，便于最终 review。
  - dteam 改造点：`DteamResult6` / `reporter.ts` / `ui/store.ts` 可在结果里聚合一个轻量 `evidence` 摘要：summonTrail、关键 signals、checkConclusion、validation command（如果有）、touched files（如果 worker 报告了）。
  - 边界：不落 `.dteam/`，不保存完整 transcript，不接管 Git diff；只在本次 tool result / UI state 内形成可读索引。

- **触发协议文案强化**：
  - 机制：OpenTeams 用 Free Chat vs Workflow mode 解释“轻协作”和“结构化可控执行”的边界，用户容易理解何时该用哪种模式。
  - dteam 改造点：`doc/10-架构与运行/14-dteam触发协议.md` 和 README 的 “When to use dteam vs dgoal” 可增加一段更产品化的说明：直接做 / dgoal / dteam 的选择，不是按任务大小，而是按是否需要多专业角色同时给出证据与收口。
  - 边界：只改文案，不改变 dteam vs dgoal 独立并列关系。

- **文件变更来源作为辅助 signal（远期观察）**：
  - 机制：OpenTeams 对每次 run 做 baseline/delta，形成 run-level changed files。
  - dteam 改造点：若未来 dteam 出现并发 worker 修改文件冲突的真实痛点，可把 Pi/harness 提供的 changed files 作为 `found` 或 `blocked` 辅助信号喂给 Orchestrator。
  - 边界：不恢复 0.5.0 FileGraph / SchedulingPlan，不在 dteam 内自己实现 Git diff 捕获。

## 4. 可借鉴的具体文件 / 代码 / 资源

- `AGENTS.md` — OpenTeams 对 Free Chat、Workflow、Projects、Session Worktrees 的一手项目定义，适合理解产品边界。
- `docs/OpenTeams-Technical-Documentation.md` — ChatSession / ChatAgent / ChatRun / Team Protocol / `.openteams/` 存储结构的早期技术总览。
- `docs/session-worktree-isolation-design.md` — session worktree 生命周期、merge/discard/cleanup 安全规则；对 dteam 只作“上层工作区隔离应由 harness 承担”的反例参考。
- `docs/agent-run-file-diff-display-report.md` — run-level 文件变更捕获链路和失败模式，适合作为未来 evidence / changed-files 辅助 signal 的参考。
- `crates/services/src/services/workflow/` — workflow compiler / orchestrator / reducer 的实现入口；用于理解为什么 OpenTeams 是“状态执行图产品”，不是 dteam 这种同步召唤池。
- `frontend/src/components/workflow/` — 工作流卡片、图、review/input UI；只参考信息呈现，不参考执行模型。

## 5. 决策记录

无。OpenTeams 的主要候选都是 UI / evidence / 文案层轻动作，未达到“难逆转 + 无上下文会困惑 + 有真实权衡”的 ADR 门槛。明确不借的 workflow graph / 持久化执行图 / 自定义团队，已由 ADR 0002、0004、0005 覆盖。

## 6. 下一步建议

建议进入一次轻量 `507-grill`，只拷问一个具体候选：**dteam 是否需要一个 Evidence Bundle 摘要字段**。它价值比 UI graph 更直接，能提升 `check` 收口的可复验性，又不冲突 ADR 0005。如果通过，再拆成小改动：先只在 `DteamResult6` 返回结构里补 evidence 摘要，不碰持久化和 Git diff。
