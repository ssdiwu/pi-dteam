# 24-harness 团队架构工厂参考

> **0.8 状态注记（2026-07-14）**：本文中出现的 Orchestrator Loop、Signal Store、五角色、Reporter，均是调研时用于对照的 0.6 历史形态，已删除。当前 dteam 已实现会话级后台 Worker Manager、唯一工具 `dteam`（dispatch/respond）、有类型 signal 和 `/dteam` 实时管理面板；以下内容只作机制比较，不描述当前实现。

> `revfactory/harness`：Claude Code 生态 L3 Meta-Factory 层的 Team-Architecture Factory。一次性生成器：输入领域描述，输出 `.claude/agents/*.md` + `.claude/skills/*/SKILL.md`。Apache 2.0。
> 仓库：https://github.com/revfactory/harness

## 6 种团队架构 pattern

| Pattern | 描述 | dteam 现状 |
|---|---|---|
| Pipeline | 顺序依赖 | 已有：`chain` 模式 |
| Fan-out/Fan-in | 并行独立 + 收口 | 已有：`team` 模式 |
| Expert Pool | 按上下文选专家 | **无**（dteam 5 角色写死，未实现按需选） |
| Producer-Reviewer | 生成 + 审核 | 已有：`build_check` 模式 |
| Supervisor | 中央调度 | 已有：`orchestrator` 角色 |
| Hierarchical Delegation | 递归委派 | **无**（dteam 故意只 1 层） |

## 与 dteam 的关系

**同思路**：
- harness 的"动态生成 agent 团队"在精神上和 dteam `planner.ts` LLM 兜底动态生成任务分解是同一思路——LLM 决定结构。**5 角色写死 ≠ 任务静态**：角色库固定，但每次任务的子任务、worker 实例、描述由 LLM 动态产生。
- 6 种 pattern 的命名 + 决策标准可作为 dteam 模式扩展参考池。**Expert Pool** 是值得评估的扩展方向（dteam 现在没有"按上下文选专家"的机制）。

**设计冲突**（不引入）：
- harness 把 agent 定义生成**静态文件**（一次性写完），dteam 是**运行时动态规划**——dteam 不需要"harness factory"层
- **Hierarchical Delegation**：多层调度违反 dteam "1 层调度"简洁原则
- harness 自报的 "+60% 质量、15/15 win-rate"（n=15, author-measured, 第三方未复现）—— 不作决策依据

## 可借鉴的具体文件

- `skills/harness/references/orchestrator-template.md` — 中央调度器设计模板，`src/orchestrator.ts` 可参考启发（**仅启发，不照搬**）
- `skills/harness/references/skill-writing-guide.md` — skill 写作方法论；dteam 当前只维护 `tier-config.ts` 内的三档 prompt，不引入 agents 文件市场

## 决策记录

- 2026-06-16：评估后加入 `doc/20-能力参考/` 作为事实参考；不引入 harness factory 抽象层，不引入 Hierarchical Delegation 模式；Expert Pool 模式待路线图评估。
