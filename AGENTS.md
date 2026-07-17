# AGENTS.md

> 写给接手 dteam 的 AI 助手和 507 自己的笔记。

## 一句话

dteam 是 **模型分级路由执行层 + 主代理证据驱动多轮路由协议**——主代理定义证据问题、分轮派 T3、综合报告并明确路由，Worker Manager 只执行已派发 worker；思考跟随档位，搞不定走 fresh 验收 → 回退强模型。与 [`pi-dgoal`](../pi-dgoal) 独立并列：dteam = 多模型分级路由，dgoal = 单模型建检循环。代码组织见 `src/README.md`。

**先读 [`doc/README.md`](./doc/README.md)、[`doc/术语表.md`](./doc/术语表.md)，再读 [`src/README.md`](./src/README.md) 后动手。**

涉及架构、模型档位、路由、回退、验收、边界收敛时，先读 [`doc/决策档案/`](./doc/决策档案/) 里的 ADR（架构决策记录）——**定位基底是 ADR 0008，主代理路由与报告当前权威是 [ADR 0020](./doc/决策档案/0020-主代理证据驱动多轮路由协议.md) + [ADR 0021](./doc/决策档案/0021-结构化工作报告区分动作完成度与验证深度.md)**。

> **当前实现**：T1/T2/T3、fresh dispatch、会话级 Worker Manager、四公开工具、有类型 signal、受限动态工具、统一 WorkerReport、parent event 单次消费、独立 `dteam-usage.jsonl` 数字账本、`/dteam` 管理和确认取消已实现；0.6 loop/signals/五角色已删除。

## 项目结构速查

| 路径 | 用途 | 重要性 |
|------|------|--------|
| `doc/README.md` | 文档导航与阅读顺序 | **必读** |
| `doc/术语表.md` | 项目术语定义 | **必读** |
| `doc/决策档案/` | 架构决策记录；改边界前必读（定位 0008，路由/报告 0020/0021） | **必读** |
| `src/README.md` | 当前实现地图 | **必读** |
| `src/runtime/types.ts` | worker、统一报告、signal、handoff 与四工具类型中心 | **必读** |
| `src/runtime/worker-manager.ts` | 会话级 worker 生命周期、signal、报告、等待、单次事件消费、用量记录与恢复 | **必读** |
| `src/runtime/usage-ledger.ts` | 独立 dteam worker 脱敏数字用量账本 | 按需必读 |
| `src/session.ts` | fresh worker session 工厂（tier/thinking/Logical Isolation） | 必读 |
| `./index.ts` | Pi 四工具与 `/dteam` 扩展入口 | **必读** |


## 开发规范

### 做
- ✅ 先读 `doc/README.md`、`doc/术语表.md`、`src/README.md` 和 `src/runtime/types.ts`
- ✅ 涉及架构、模型档位、路由、回退、验收、边界收敛时，先读 `doc/决策档案/`
- ✅ 改完后跑 `npm run build` 验证
- ✅ 改完后跑 `pi -e ./index.ts` 试加载
- ✅ 保持文件数合理（按职责拆，不强求数量）
- ✅ 用 LLM 的 tool calling 做结构化输出，**不要解析自由文本**

### 不做
- ❌ 不要做 resume（见 ADR 0004；要做先单独写方案）
- ❌ 不要重新发明 parser（用 LLM tool calling 替代）
- ❌ 不要默认 spawn 独立 OS 子进程（用进程内 `AgentSession` + Logical Isolation）
- ❌ 不要重新引入 Orchestrator Loop / Signal Store / 对抗回合 / 积分制（已被 0008 推翻）
- ❌ 不要把五角色（explore/design/build/check/close）当现役结构——已被 T1/T2/T3 取代（0008）
- ❌ 不要为低价值想法新造术语、关系类型、状态层或配置层；没有第三次重复和明确痛点前，先用现有档位 / dispatch / 文档表达。

## 设计收敛纪律

- dteam 的默认方向是收敛到「主代理证据驱动多轮路由 + T1/T2/T3 + 会话级后台 Worker Manager + 四公开工具 + 统一 WorkerReport + 回退 + fresh 验收」，不是继续扩展成通用多 agent 平台，也不是回到对抗式合议/自发生长。
- 新增概念前先写真实失败样例：哪个现有机制承载不了、会造成什么错误、如何验证新机制降低复杂度；没有证据就不新增。
- 涉及角色市场、持久化、resume、编排循环、信号系统等扩展型设计时，默认先拒绝或降级为文档观察，除非 ADR 级别拷问通过。
- 文档也要防术语膨胀：术语表只收稳定、反复使用、会影响实现命名的词；临时想法不要写进术语表。

## 验证流程

改完后**必须**跑：

```bash
# 1. 编译
npm run build

# 2. 在 Pi 里重载
# 按 /reload

# 3. 实际调 dteam
# 调 dteam_dispatch({ workers: [{ title: "...", task: "...", tier: "T3" }] })，并检查新 WorkerReport 与 /dteam 展示。
```

**如果 build 失败，必须先修。**
**如果 build 过但 dteam 调不通，贴错误信息。**

## 改动的边界

> 0008 执行层、0020 主代理协议与 0021 报告合同已落。下表是按当前边界迭代时该改哪里。

| 想加什么 | 怎么办 |
|----------|--------|
| 改 dispatch / lifecycle | 改 `src/runtime/worker-manager.ts` / `src/session.ts` |
| 改 WorkerReport | 改 `src/runtime/types.ts` + `src/runtime/report-tool.ts`，同步 Manager、TUI、测试、API 与术语表 |
| 改模型档位配置 | 改 `src/session/model-config.ts` 与 `~/.pi/agent/pi-dteam.json`；档位默认见 `src/session/tier-config.ts` |
| 改对外工具 | 改 `./index.ts` + `src/runtime/types.ts`，保持 dispatch / respond / recover / wait 分工 |
| 加新工具 | **不推荐**——先证明四工具与现有 signal 无法承载，再走 ADR 级对齐 |


## 状态机提醒

> 当前入口没有独立 Orchestrator Loop 状态机：主代理在对话里定义证据问题、分轮 dispatch、综合 WorkerReport、按需实现 / fresh 验收 / 回退；Manager 不知道轮次和下一步。

## 发版流程

发布 npm 版本前必须走同一条链路：

1. 同步版本号：`package.json` + `package-lock.json`。
2. 更新 `CHANGELOG.md`，把用户可见变更、关键推翻项和验证结果落到对应版本段。
3. 确认 `package.json` 版本、`CHANGELOG.md` 版本段、`git tag v<x.y.z>` 三者一致。
4. 运行验证：`npm run build` + `npm test`；真实 LLM 行为另做 Pi TUI smoke test 并记录结果。
5. 提交单一主题 commit，再 `git tag v<x.y.z>`。
6. 发布：`npm publish`；发布后 `git push && git push --tags`。

## 提交规范

每次 `Git commit`（Git 提交）只做一件事。

示例：
- `feat: 实现 dteam 分级路由`
- `refactor: 五角色配置改为 T1/T2/T3 档位`
- `docs: 更新 doc/30-路线图/30-项目路线图.md`

**提交前**：
- `npm run build` 通过
- 改动的文件数 ≤ 5

## 联系 / 上下文

- 这个项目是 507（diwu）的
- 当前版本：见 `package.json` 的 `version` 字段
- 设计参考：ant-colony（多态分工 + Multi-Provider Routing + Adaptive Concurrency 的源头）

- 术语表：见 `doc/术语表.md`
- 决策记录：见 `doc/决策档案/` + git log

## 文档沉淀出口

三个沉淀出口按边界分工，不混用：

- **`doc/术语表.md`** — 回答"这个词指什么"，收项目特有概念；定义"是什么"，不沾实现细节。惰性创建，术语敲定时当场写。
- **`doc/决策档案/`** — 回答"为什么这么定"，只收"难逆转 + 无上下文会困惑 + 有真实权衡"的决策（刻碑，记了就不删）。一条一文件，顺序编号 `0001-中文标题.md`（项目术语沿用术语表规范叫法）；维护 `README.md` 索引（编号 + 标题 + 一句话主旨），新增 / 更新 ADR 时同步。
- **`doc/经验笔记.md`** — 回答"这事儿怎么做"，收可改的做法与避坑经验（活页）。门槛：解决一个坑时，如果换一个无上下文的 agent 来会重走一遍，就值得记。格式：现象 + 做法 + 证据。重复发生时在原条目追加证据，不新建条目。

## 代码工程纪律

> 以下纪律适用于代码项目，由 `507-setup` 写入。源自全局 `~/.pi/agent/AGENTS.md` 的代码专属条款。

- **删除测试判断模块价值**：判断一个模块/抽象是否值得存在，想象删掉它——复杂度消失说明它只是透传（删）；复杂度在多个调用处重新出现，说明它在真正减负（留）。
- **接缝纪律**：只在真有变化的地方引入接口/抽象层。只有一个实现（adapter）的是"假设接缝"，两个以上不同实现才是真接缝；别为单一用法提前抽接口。
- **函数粒度**：函数控制在 100 行以内；超出则考虑拆分。
- **测试看行为**：测试优先通过公共接口验证行为，不测内部实现；mock 只放在系统边界。
- **先建反馈环再调 bug**：调 bug 先造一个快速、确定性、agent 能跑的 pass/fail（成败）信号（失败测试/curl/CLI 重放/headless 等）；没有反馈环就别盯着代码空猜，列已试方法后求助用户。信号是 90% 的调试，其余是机械操作。
- **插桩打 tag**：所有临时 debug 日志打唯一前缀 tag（如 `[DEBUG-a4f2]`），清理时一个 grep 全删；未打 tag 的临时日志会残留。
