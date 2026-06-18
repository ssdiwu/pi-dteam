# AGENTS.md

> 写给接手 dteam 的 AI 助手和 507 自己的笔记。

## 一句话

dteam 是 **基于 goal（目标）自发生长的多 worker 群策群力扩展**——简单任务主 LLM 直接干，需要群策群力（召唤多个专业角色）时进入同步前台 Orchestrator Loop（编排循环）。与 [`pi-dgoal`](../pi-dgoal) 独立并列：dteam = 群策群力，dgoal = 建检循环。代码组织见 `src/README.md`。

**先读 [`doc/README.md`](./doc/README.md)、[`doc/术语表.md`](./doc/术语表.md)，再读 [`src/README.md`](./src/README.md) 后动手。**

涉及架构、角色、编排循环、持久化、并发、边界收敛时，先读 [`doc/adr/`](./doc/adr/) 里的 ADR（架构决策记录）——**当前骨架权威是 [`doc/adr/0005-dteam-0.6.0-重定义为自发生长召唤池.md`](./doc/adr/0005-dteam-0.6.0-重定义为自发生长召唤池.md)**。

## 项目结构速查

| 路径 | 用途 | 重要性 |
|------|------|--------|
| `doc/README.md` | 文档导航与阅读顺序 | **必读** |
| `doc/术语表.md` | 项目术语定义 | **必读** |
| `doc/adr/` | 架构决策记录；改边界前必读 | **必读** |
| `src/README.md` | 当前实现定义文档 | **必读** |
| `src/tools.ts` | 工具表（Pi 提供的 / dteam 暴露的 / 内部 helper） | **必读** |
| `src/orchestrator.ts` | 主循环（0.6.0 重写为 Orchestrator Loop） | 必读 |
| `src/planner.ts` | 规划器（旧穷举式；0.6.0 后被 Orchestrator Loop 取代） | 必读 |
| `src/leaf.ts` | 调 LLM 干活（进程内 worker 执行层） | 必读 |
| `src/pool.ts` | 任务池（内存；0.6.0 代码改造后退场） | 必读 |
| `./index.ts` | Pi 扩展入口（根目录） | **必读** |


## 开发规范

### 做
- ✅ 先读 `doc/README.md`、`doc/术语表.md`、`src/README.md` 和 `src/tools.ts`
- ✅ 涉及架构、角色、编排循环、持久化、并发、边界收敛时，先读 `doc/adr/`
- ✅ 改完后跑 `npm run build` 验证
- ✅ 改完后跑 `pi -e ./extensions/index.ts` 试加载
- ✅ 保持文件数合理（按职责拆，不强求数量）
- ✅ 用 LLM 的 tool calling 做结构化输出，**不要解析自由文本**

### 不做
- ❌ 不要加文件锁、原子操作
- ❌ 不要做双层验收（一次 `check` 收口够）
- ❌ 不要做 resume（见 ADR 0004；要做先单独写方案）
- ❌ 不要重新发明 parser（用 LLM tool calling 替代）
- ❌ 不要预先穷举 Task Plan / DPlan（召唤轨迹即计划，见 ADR 0005）
- ❌ 不要默认 spawn 独立 OS 子进程（用进程内 `AgentSession` + Logical Isolation，见 ADR 0005）

> **0.6.0 并发口径更新**：旧"不要做自适应并发"条款已撤销——[ADR 0005](./doc/adr/0005-dteam-0.6.0-重定义为自发生长召唤池.md) 采纳 Adaptive Concurrency（自适应并发）+ Multi-Provider Routing（多供应商路由）应对并发墙。原先担忧的"动态调 batchSize 让结果不可预测"由 Signal Store（TTL 衰减）+ 429 自适应机制回应。

## 验证流程

改完后**必须**跑：

```bash
# 1. 编译
npm run build

# 2. 在 Pi 里重载
# 按 /reload

# 3. 实际调 dteam 工具（0.6.0：同步前台 Orchestrator Loop）
# 让主 LLM 调 dteam(goal="简单任务")，或用户 /dteam <goal>
```

**如果 build 失败，必须先修。**  
**如果 build 过但 dteam 调不通，贴错误信息。**

## 改动的边界

> 0.6.0 代码已落地（Orchestrator Loop + SignalStore + 强制 check 收口）。实施记录见 [`doc/40-版本实施方案/42-v0.6.0-召唤池重定义实施方案.md`](./doc/40-版本实施方案/42-v0.6.0-召唤池重定义实施方案.md)。下表是继续迭代时该改哪里。

| 想加什么 | 怎么办 |
|----------|--------|
| 改 Orchestrator Loop 主循环 | 改 `orchestrator.ts`（旧 Plan→Execute→Report 改为 LLM 驱动循环） |
| 改 worker 执行层 | 改 `leaf.ts` / `session.ts`（进程内 `AgentSession` + Logical Isolation + Multi-Provider Routing） |
| 改 Signal Store | 改 `signals/`（TTL 衰减，单 goal 生命周期） |
| 改对外暴露的 dteam 工具 | 改 `./index.ts`（`/dteam <goal>` + 主 LLM 自动拉起） |
| 加新工具 | **不推荐**——dteam 故意只暴露 1 个工具 |
| 旧 planner / scheduler | 0.6.0 后降级（planner 被 Orchestrator Loop 取代；scheduler 降为辅助信号） |


## 状态机提醒

> 0.6.0 重定义后，状态以 Orchestrator Loop + Signal Store 为核心（旧 WorkItem/TaskPool 在代码改造后退场）。

Orchestrator Loop 推进依赖 Signal Store 的四类信号：`progress` / `found` / `blocked` / `help`，靠 `session.subscribe` 事件流表达。Signal Store 采用 TTL 衰减：新信号优先，旧信号过期。


## 提交规范

每次 `Git commit`（Git 提交）只做一件事。

示例：
- `feat: 让 leaf 实际能改文件`
- `fix: 修正 planner 结构化输出解析逻辑`
- `docs: 更新 doc/30-路线图/30-项目路线图.md`

**提交前**：
- `npm run build` 通过
- 改动的文件数 ≤ 5

## 联系 / 上下文

- 这个项目是 507（diwu）的
- 当前版本：见 `package.json` 的 `version` 字段
- 设计参考：ant-colony（`/Users/diwu/.pi/agent/extensions-backup/ant-colony.disabled/`）

- 术语表：见 `doc/术语表.md`
- 决策记录：见 `doc/adr/` + git log
