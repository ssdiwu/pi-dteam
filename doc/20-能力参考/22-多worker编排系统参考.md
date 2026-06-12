# 多 worker 编排系统参考

> 目的：把分散的外部调研收敛成对 dteam 0.5.0 有决策价值的参考。单包长文已归档到 `../90-归档/能力参考/`。

## 1. 当前结论

0.5.0 要借的不是“更多 agents”，而是：

> **最小 SwarmFlow / MiMo 式编排确定性：可确定的协作关系由 dteam runtime 执行，智能推理留给 worker。**

这直接落到 0.5.0：

- planner 给初始 `PlanStep.files`
- dteam runtime 补轻量 file graph
- `team` 模式做 preflight scheduling
- 显式冲突 / shared file / dependency edge 自动拆批
- UI 和 report 必须解释为什么这样调度
- 完成态保留，方便回溯上一轮 dteam 做了什么

## 2. SwarmFlow：编排和智能分离

SwarmFlow 的关键判断：

> 谁先做、谁并行、谁把结果交给谁、失败怎么处理，是编排；每个节点怎么理解和生成，是智能。

对 dteam 的启发：

| SwarmFlow 做法 | dteam 0.5.0 采用方式 |
|---|---|
| 编排逻辑从 Leader Agent 临场判断里抽出来 | dteam runtime 负责 preflight scheduling |
| 确定流程才固化 | 只固化文件边界 / 依赖图 / batch，不固化 review/TDD/merge 流水线 |
| 可观察 workflow tree | `/dteam` 展示 batch / worker / delayed reason |
| human 节点 | dteam 继续用 `help` + `continue` |
| budget / retry 等工程能力 | 暂不做 |

不借：

- 不引入 `workflow.py`
- 不做通用 workflow 平台
- 不做可视化流程编辑器

## 3. MiMo Code：结构化编排与旁路角色

MiMo Code 重点不是“多代理数量”，而是长程编程任务的可靠性。

| 机制 | dteam 取舍 |
|---|---|
| Dynamic Workflow：把编排写成代码 | 借“编排结构化”思想；0.5.0 用 TypeScript runtime scheduler，不暴露 workflow 脚本 API |
| Goal Verifier：结束前独立检查 | 远期可做可选策略，不进入 0.5.0 |
| Checkpoint Writer：旁路写状态 | 0.5.0 用 `pi.appendEntry()` 写 plan / scheduling checkpoint；远期再考虑 writer worker |
| Max Mode | 不做，token 成本高 |
| Dream / Distill | 不做，过重 |

对 dteam 0.5.0 的关键启发：

- 主 worker 不负责记忆、调度和验证所有事情
- runtime 应该接管确定性编排
- 状态 checkpoint 应写入 Pi session，但不污染 LLM context

## 4. pi-subagents：产品体验和安全边界

参考页：`https://pi.dev/packages/pi-subagents`。

| pi-subagents 做法 | dteam 借鉴 |
|---|---|
| 自然语言 “Try this first” | README / API 文档补“什么时候该调 dteam” |
| background runs + async widget | dteam 已后台运行；0.5.0 重做 widget |
| grouped result | `dteam-report.details` 保留 plan / scheduling / worker tree |
| status tree | `/dteam` tabs 展示 batch / Workers / 信号 / 报告 |
| child safety boundaries | 保留 5 角色写死 + build 唯一可 edit |
| doctor | 远期可选，不进 0.5.0 |
| agent / chain 文件体系 | 不借，dteam 当前角色写死 |

## 5. rpiv-todo：运行态 UI

rpiv-todo 的核心价值是 UI，而不是 todo 工具本身。

| rpiv-todo 做法 | dteam 0.5.0 采用方式 |
|---|---|
| 轻量任务树 | widget 改成 dteam worker tree |
| done 删除线 + dim | done worker 删除线弱化 |
| 当前项突出 | running 用 accent |
| 完成项保留到下次 response | dteam 完成态保留到下一次 dteam run |
| 空态自动隐藏 | widget 空态隐藏 |
| branch replay | 远期 persistence 参考 |

不借：

- 不集成 todo 工具
- 不引入 `blockedBy`
- 不做 deleted tombstone

## 6. oira666/pi-subagent：进程隔离参考

归档长文：`../90-归档/能力参考/22-与pi-subagent对比.md`。

当前结论：

- 进程级隔离有价值，但不是 0.5.0。
- dteam 当前继续 in-process `createAgentSession`。
- API key 共享、启动速度、customTools 是 dteam 当前优势。
- 远期如果 leaf 崩溃频繁，再评估 spawn `pi` 子进程。

## 7. 其它参考的当前取舍

| 来源 | 当前取舍 |
|---|---|
| pi-roadmap | 不集成；dteam 路线图继续 markdown 手写 |
| pi-context-manager | 不集成；可单点借 strip ANSI / 截断，非 0.5.0 主线 |
| rezero | 不借 Return by Death；多维 check 远期可选 |
| Remnic | 不集成 daemon；可与 dteam 共存 |

## 8. 对 0.5.0 的设计约束

### 要做

- 轻量 file graph
- preflight scheduling
- 自动拆批
- batch / conflict / dependency reason 可见
- 运行态 widget 重做
- `/dteam` 内容型 tabs
- `pi.appendEntry()` checkpoint
- `dteam-report.details` 可回溯

### 不做

- 固定 6 阶段流水线
- workflow 脚本 API
- 文件锁 / worktree / 自动 merge
- 进程级隔离
- 自定义角色系统
- Max Mode / Dream / Distill

## 9. 归档索引

单包调研长文移到：

| 归档文件 | 用途 |
|---|---|
| `../90-归档/能力参考/22-与pi-subagent对比.md` | 进程隔离 / resume / usage tree 参考 |
| `../90-归档/能力参考/23-与pi-roadmap对比.md` | 项目管理工具参考 |
| `../90-归档/能力参考/24-与pi-context-manager对比.md` | 上下文压缩参考 |
| `../90-归档/能力参考/25-与rezero对比.md` | 多维 check / 重置式重试参考 |
| `../90-归档/能力参考/26-与remnic-plugin-pi对比.md` | 长期记忆 daemon 参考 |
| `../90-归档/能力参考/27-与rpiv-todo对比.md` | todo UI / branch replay 参考 |
