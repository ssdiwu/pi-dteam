# Routa 任务协议与 DoD 参考

> 目的：把 Routa 的 Harness 工程 / Kanban / DoD（Definition of Done，完成定义）思想映射到 dteam，明确哪些轻量借鉴值得进入 0.5.x，哪些暂不做，避免把 dteam 做成重型工作流平台。

## 1. 当前结论

Routa 对 dteam 最有价值的不是 Kanban（看板）本身，而是：

> **完成不是口头判断，而是带证据、门禁和显式交接的任务协议。**

对 dteam 的轻量翻译：

- worker 不是越多越好，职责边界越清楚越好
- runtime（运行时）负责可确定的调度和门禁，LLM worker 负责具体理解与实现
- `done` 不只是“worker 说完成”，而是 report（报告）里有可回溯证据
- 遇到冲突 / 缺证据 / 失败时，不假装完成，要显式 blocked / delayed / failed

## 2. 概念映射

| Routa 概念 | 含义 | dteam 轻量映射 | 取舍 |
|---|---|---|---|
| Harness 工程 | 把规则、约束、验证步骤变成可执行护栏 | `scheduler` + `reporter` + `dteam-report.details` | 借护栏思想，不做完整 Harness 平台 |
| Kanban 任务协议 | 列代表阶段、交接边界和门禁要求 | `ExecutionPlan.steps` + `SchedulingPlan.batches` | 不做持久化看板，只保留运行态协议 |
| DoD | 完成定义：开发完成 + 交付完成 + 证据 | `RunResult` / `dteam-report` 的 summary + details | 0.5.x 先增强证据，不做复杂审批 |
| Lane specialist | 每列一个专职 agent | 固定角色 `explore / design / build / check / close` | 保持 5 角色写死，不开放角色市场 |
| move_card | 明确交接给下游 | `orchestrator` 按 step / batch 推进 | 不引入外部 card 状态机 |
| Gate / 打回 | 不满足条件不能前进 | conflict / delayed / failed / check result | 先做轻量标记和报告，不做自动返工循环 |
| Monitor / Dashboard | 观察多个 agent 的状态和质量信号 | `/dteam` widget / panel / signals | 只做运行态可见性，不做独立 dashboard |
| Evidence | 开发、验证、评审证据 | step files、tool output、scheduling reason、final report | 优先结构化已有证据，不扩写长日志 |

## 3. Routa 流程到 dteam 的轻量翻译

Routa 的 `backlog → todo → dev → review → done` 不能直接搬到 dteam，但可以翻译成一次 run 内的轻量协议：

| Routa 阶段 | Routa 产物 | dteam 对应层 | dteam 轻量产物 |
|---|---|---|---|
| backlog | story / AC / 影响 / 依赖 | 主 LLM 是否调用 dteam | 用户 goal + 主 LLM 判断复杂度 |
| todo | 执行计划 / 文件 / 风险 | `planner` | `ExecutionPlan` + `PlanStep.files` |
| dev | 实现 + Dev Evidence | `build` worker | 代码改动 + worker result + touched files |
| review | 验证据 / 范围 / 独立性 | `check` worker / runtime report | test result / scheduling reason / failed reason |
| done | APPROVED 后交付 | `close` + `dteam-report` | summary + details + next action |

关键区别：

- Routa 是长周期任务系统；dteam 是 Pi 当前会话里的后台协作引擎。
- Routa 的列是持久状态；dteam 的状态是一次 run 内的 runtime state。
- Routa 可以要求严格门禁；dteam 应先用轻量证据和可解释报告，不阻断个人工作流。

## 4. 对 0.5.x 有价值的轻量落点

### 要做

| 方向 | 轻量做法 | 价值 |
|---|---|---|
| Evidence summary | `dteam-report.details` 继续整理 plan / files / scheduling / validation | 让“完成”可回溯 |
| Gate reason 可见 | `/dteam` 展示 delayed / conflict / failed 的短原因 | 让用户知道为什么没并行或没完成 |
| 交接语义清晰 | report 中按 `planner → scheduler → worker → check → close` 展示 | 避免多 worker 噪音 |
| check 结果显式 | 若有 check step，明确列出验证命令 / 结果 / 未验证原因 | 避免乐观 done |
| blocker 轻量化 | worker blocked 时只要求简短 blocker / impact / next | 保持个人工作流不中断 |

### 暂不做

| 方向 | 暂不做理由 |
|---|---|
| 持久 Kanban | dteam 不是项目管理工具，避免变成 Routa 复刻 |
| 每列专属 agent 市场 | 当前 5 角色写死更轻、更安全 |
| 自动打回循环 | 会引入隐性长跑和不可控 token 成本 |
| 审批式 done | 个人编程 workflow 不需要重审批 |
| 独立 Dashboard | `/dteam` 面板已覆盖运行态可见性 |

### 远期

| 方向 | 触发条件 | 可能形态 |
|---|---|---|
| Goal verifier | dteam 频繁乐观完成 | 可选 verifier worker，不固定流水线 |
| Done contract | report 经常缺关键信息 | 最小 `doneEvidence` 字段，不做复杂 schema |
| Retry / 打回 | check 失败但修复路径明确 | 一次可控 retry，不做无限循环 |
| Session resume | 后台任务中断频繁 | 轻量 checkpoint + status，不做完整 Kanban |

## 5. dteam 的 DoD 建议

dteam 的完成定义应保持轻量，建议分三层：

| 层级 | 要求 | 不要求 |
|---|---|---|
| 技术完成 | worker 完成对应 step，必要文件 / 命令 / 输出可追踪 | 不要求完整项目验收体系 |
| 验证完成 | 能跑的测试 / build 已跑；不能跑时说明原因 | 不要求每次都强制全量测试 |
| 协作完成 | report 说明执行路径、调度原因、风险和下一步 | 不要求审批流或 Kanban 状态迁移 |

最小报告结构可以是：

```text
summary: 做了什么
changed: 关键文件 / step
verified: 跑了什么验证，结果如何
scheduling: 为什么并行 / 串行 / 延后
risks: 未验证或需用户确认的点
next: 建议下一步
```

## 6. 设计边界

Routa 的启发应服务于 dteam 当前定位：

> **Pi 里的轻量多 subagent 协作引擎。**

因此 dteam 不追求成为：

- 通用 Kanban 系统
- 企业级 Harness 平台
- 多 agent 流程编排 IDE
- 持久项目管理数据库

dteam 要做的是：

- 在复杂任务里把 worker 分工讲清楚
- 把能确定的冲突 / 依赖 / 调度交给 runtime
- 把完成证据收进 report
- 让用户能在 Pi 里低成本理解和接管
