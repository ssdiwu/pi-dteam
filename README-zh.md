# dteam

> **基于 goal（目标）自发生长的多 worker 群策群力扩展 —— 召唤池式的群策群力。**
>
> 简单任务由主 LLM 直接完成；需要**群策群力**（召唤多个专业角色协作）时，dteam 进入同步前台的 **Orchestrator Loop（编排循环）**。
>
> 0.6.0 重定义已落地：dteam 现在是基于 goal 自发生长的召唤池，同步前台 Orchestrator Loop（不再是后台二维编排引擎）。旧的 `solo/chain/team` 引擎、`planner`/`pool`/`scheduler` 及 0.5.0 编排类型已删除。18 条根本决策见 [`doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md`](./doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md)。

**姊妹项目**：[`pi-dgoal`](https://github.com/ssdiwu/pi-dgoal) —— 独立并列。**dteam = 群策群力（召唤池），dgoal = 建检循环（单兵 + 独立审核）**。主 LLM 自己判断用哪个，不合并、不自动切换。英文版：[`README.md`](./README.md)。

## TL;DR

dteam 从 goal 自发生长。主 LLM 遇到需要群策群力的任务时，按需召唤固定角色 worker：`explore` / `design` / `build` / `check` / `close`。

- **同步前台 Orchestrator Loop** —— 不再后台；循环阻塞主对话直到 `check` 收口。
- **进程内 `AgentSession` worker + Logical Isolation（逻辑隔离）** —— 默认不 spawn OS 子进程。
- **Signal Store（信号存储，TTL 衰减）** —— worker 通过 `session.subscribe` 发出 `progress / found / blocked / help`；Orchestrator 每轮读取决策。
- **LLM 驱动编排** —— 每轮一次 LLM 调用决定下一步召唤谁。
- **Adaptive Concurrency（自适应并发）+ Multi-Provider Routing（多供应商路由）** —— 可同时召唤多 worker，每角色可配主模型 + fallback 链，避免单供应商并发墙。
- **Completion Gate（收口闸门）** —— Orchestrator 不能自停；每个 goal 必须召唤 `check` 通过才算完成。
- **固定五角色** —— 不做角色市场；`build` 是唯一能 `edit`（编辑）现有文件的角色。

## 当前状态（0.6.0）

`src/` 代码已重写为 0.6.0 召唤池形态：同步前台 `runLoop`、进程内 `AgentSession` worker + Logical Isolation、Signal Store TTL 衰减、Adaptive Concurrency + Multi-Provider Routing、强制 `check` 收口。0.5.0 的后台 `run`/`runId` 引擎、`planner`/`pool`/`scheduler`、二维编排类型均已删除。

**输出契约（tool calling）**：Orchestrator 决策与 `check` 收口结论用 Pi tool calling（`orchestrator_decide` / `check_conclude` customTool）——LLM 调用 tool 即结构化输出，runLoop 从 receiver 取。取代了脆弱的自由文本 JSON 解析和关键词猜测（见 `doc/40-版本实施方案/43-v0.6.0-真实运行探测报告.md`）。

**已端到端验证**：`glm-5.2` 下跑通完整 goal → `check` 收口闸门 → `status=done`（见 `doc/40-版本实施方案/smoke-logs/glm-5.2-end-to-end-done.log`）。

- [ADR 0005 —— 0.6.0 重定义为自发生长召唤池](./doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md) —— 18 条决策。
- [0.6.0 召唤池重定义实施方案](./doc/40-版本实施方案/42-v0.6.0-召唤池重定义实施方案.md) —— 已端到端验证通过（2026-06-22）。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编译
npm run build

# 3. 跑测试
npm test

# 4. 安装到 Pi
pi install "$(pwd)"

# 5. 在 Pi 里 /reload

# 6. 调用 dteam（0.6.0 同步前台 Orchestrator Loop）
# /dteam <goal>          （用户显式）
# dteam(goal="...")      （主 LLM 自动）
# action=run 阻塞主对话直到 check 收口。

# 7. /dteam 命令
# 在 Pi 里输入 /dteam 打开实时进度面板
```

## 四类信号

worker 把四类信号写入 Signal Store：

| 信号 | 何时发 | Orchestrator 的处理 |
|------|--------|---------|
| **progress** | 完成一个动作 / 步骤 | 更新 Signal Store；影响下一步召唤决策 |
| **found** | 发现计划外信息 | 写入存储；可能触发同伴转发 |
| **blocked** | 受阻 / 失败 | Orchestrator 召唤 `explore` 自愈，或换角色 |
| **help** | 自己解决不了 | 第 1 次：召唤 `explore` 补充信息<br>第 2 次：升级到人类 |

## 什么时候用 dteam vs dgoal

一句话规则：**简单任务主 LLM 直接干；单兵能持续推进 + 需独立审核走 dgoal；需要群策群力（召唤多个专业角色）走 dteam；用户明确指定时尊重用户。**

| 判断 | 走哪个 |
|---|---|
| 单代理能干，自己推进 | 主 LLM 直接做 |
| 单兵推进 + 需要独立零上下文终审 | **dgoal**（建检循环） |
| 需要召唤多个专业角色协作（explore/design/build/check/close） | **dteam**（群策群力） |
| 用户明确说"用 dteam" | **dteam** |
| 用户明确说"用 dgoal / /dgoal" | **dgoal** |

完整协议见 [`doc/10-架构与运行/14-dteam触发协议.md`](./doc/10-架构与运行/14-dteam触发协议.md)。

## 文档

> 仓库分 3 层：`index.ts` + `src/` + `agents/` 是运行时核心，`tests/` 是验证层，`doc/` 是当前文档层。重构时先改运行时核心和当前文档。

- [文档导航](./doc/README.md)
- [ADR 0005 —— 0.6.0 召唤池重定义（当前骨架权威）](./doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md)
- [术语表](./doc/术语表.md)
- [系统架构（Orchestrator Loop + Signal Store）](./doc/10-架构与运行/10-系统架构.md)
- [角色系统（固定五角色，check = 收口闸门）](./doc/10-架构与运行/11-角色系统.md)
- [工具 API 参考（同步前台执行）](./doc/10-架构与运行/12-API参考.md)
- [v2 设计与实施现状（二维编排已被 0.6.0 推翻）](./doc/10-架构与运行/13-设计-v2与实施现状.md)
- [dteam 触发协议（dteam vs dgoal）](./doc/10-架构与运行/14-dteam触发协议.md)
- [项目路线图](./doc/30-路线图/30-项目路线图.md)
- [0.6.0 召唤池重定义实施方案](./doc/40-版本实施方案/42-v0.6.0-召唤池重定义实施方案.md)
- [0.5.0 轻量依赖图调度方案（已归档）](./doc/90-归档/版本实施方案/41-v0.5.0-轻量依赖图调度与运行态UI实施方案.md)
- [多 worker 编排系统参考](./doc/20-能力参考/22-多worker编排系统参考.md)
- [src/ 内部架构](./src/README.md)
- [CHANGELOG.md](./CHANGELOG.md)
- [English README](./README.md)

## 目录结构

```
.
├── index.ts                 # Pi 扩展入口（注册 dteam 工具 + /dteam 命令）
├── src/
│   ├── orchestrator-loop.ts # 0.6.0 Orchestrator Loop 主循环（LLM 每轮决策）
│   ├── orchestrator-loop/   # decision.ts / check-gate.ts / concurrency.ts / model-routing.ts
│   ├── leaf.ts             # worker 执行层（进程内 AgentSession + Logical Isolation）
│   ├── session.ts          # createWorkerSession 工厂（logicalIsolation + onSession）
│   ├── tools.ts            # 类型中心（0.6.0 纯 re-export；编排类型在 types/loop.ts）
│   ├── reference-data.ts   # reference_architecture 工具（12 架构模式 + ADR 模板）
│   ├── reporter.ts         # Reporter 接口
│   ├── config.ts           # DTEAM_CONFIG 集中常量
│   ├── signals/            # 0.6.0 目标：Signal Store（TTL 衰减）
│   ├── types/              # 拆分类型
│   ├── scheduler/          # 0.5.0 文件图 + 预检调度（0.6.0：降级为辅助信号）
│   ├── ui/                 # UI 模块（store / panel / helpers）
│   ├── session/            # session.ts 拆分（role-config / role-prompt / model-resolver / ...）
│   ├── leaf/               # leaf.ts 拆分
│   └── orchestrator/       # orchestrator.ts 拆分（signal-handlers / strategies / ...）
├── agents/                 # 5 个角色定义（explore / design / build / check / close）
├── tests/                  # 测试文件
└── doc/                    # 全部文档（中文文件名）；adr/ 存决策记录
```

## 设计哲学（0.6.0）

- **goal 驱动自发生长**：任务从执行中涌现，不预先穷举 plan；召唤轨迹即计划。
- **群策群力，非流水线**：五个固定角色被 Orchestrator 按需召唤，不是固定阶段。
- **同步前台 Orchestrator Loop**：实时读信号、动态决策；用阻塞换取实时协作。
- **进程内 worker + 逻辑隔离**：`SessionManager.inMemory()` + 最小 ResourceLoader + 工具白名单，替代 OS 子进程隔离。
- **Signal Store TTL 衰减**：复用现有信号机制；临时、单 goal、不落项目目录。
- **Adaptive Concurrency + Multi-Provider Routing**：吞吐不受单供应商并发墙限制。
- **收口闸门**：强制 `check` 收口；Orchestrator 不能自停。
- **与 dgoal 并列**：群策群力（dteam）vs 建检循环（dgoal），独立不合并。

## 验证状态

- ✅ 0.6.0 代码已落地（Orchestrator Loop + Signal Store + Logical Isolation + Adaptive Concurrency + Multi-Provider Routing + 强制 check 收口）
- ✅ 0.5.0 编排代码已删（orchestrator.ts / planner.ts / pool.ts / scheduler/ / 二维编排类型）
- ✅ `npm run build` 通过；`npm test` 绿（140 个单测；vi.mock 验证决策流转/并发/路由）
- ⏳ 端到端真实 LLM 跑通 `/dteam <goal>` 需在有 API key 的 Pi 环境手动验证

## 相关链接

- Pi 扩展开发：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
- 姊妹项目 pi-dgoal：<https://github.com/ssdiwu/pi-dgoal>
