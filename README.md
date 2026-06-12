# dteam

> **Pi 里的轻量多 subagent（子代理）协作引擎**。
>
> 简单任务主 LLM 直接干；复杂编程任务才调 dteam，进入后台多 worker 协作状态。
>
> 当前基线：v0.5.0 已落地：轻量依赖图调度 + 运行态 UI 重做。dteam 会把可确定的文件冲突 / 依赖关系交给 runtime（运行时）调度，并通过 widget、`/dteam` 和 `dteam-report` 解释过程。

## 一句话

dteam 让主 LLM 在遇到复杂任务时，把工作交给一组写死角色的 worker：`explore` / `design` / `build` / `check` / `close`。

它用二维编排描述协作：**组织形式**（solo / chain / team）× **执行策略**（direct / build_check / adaptive）。运行方式是后台：`run` 立即返回 `runId`，过程看 `/dteam` 面板，结束看 `dteam-report`。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编译
npm run build

# 3. 运行测试
npm test

# 4. 安装到 Pi
pi install "$(pwd)"

# 5. 在 Pi 里按 /reload 重载

# 6. 调 dteam 工具
# 后台执行：dteam(action="run", goal="你的目标")
# 用户回复继续：dteam(action="continue", runId="...", message="你的回复")

# 7. /dteam 命令
# 在 Pi 里输 /dteam 打开实时进度面板
```

## 用法

### 工具 API

dteam 暴露 1 个工具，2 个 action：

```typescript
// 后台启动（立即返回，不阻塞前台）
dteam(action="run", goal="你的目标")
// → { status: "running", runId: "run-xxx" }

// 人类回复后继续（叶子在等人类输入时）
dteam(action="continue", runId="run-xxx", message="你的回复")
// → { content: "已注入到 run-xxx" }
```

### 后台任务模型

`dteam(action="run")` 采用后台任务模式：

1. 启动时立即返回 `runId`
2. 后台继续执行，不阻塞主对话
3. 实时进度主要看 `/dteam` 面板 / `widget`（小组件）/ `status`（状态栏）
4. 完成后通过 `dteam-report`（结果报告）消息回到主对话
5. 不依赖已结束工具调用的 `onUpdate`（流式更新回调）推送后台进度
6. 完成态保留到下一次 dteam run，方便回看上一轮结果

### `/dteam` 命令

在 Pi 里输入 `/dteam`：

| 命令 | 行为 |
|---|---|
| `/dteam` | 展开 / 折叠面板 |
| `/dteam 0` | 概览：goal、mode、summary、当前批次、关键 warning |
| `/dteam 1` | 批次：batches、delayedBecause、conflicts |
| `/dteam 2` | Workers：worker 树、files、最多 2 行输出 |
| `/dteam 3` | 信号：聚合 found / progress / help / blocked |
| `/dteam 4` | 报告：运行中待完成，完成后 final summary |
| `/dteam close` | 关闭面板 |

### 4 种信号

叶子在跑过程中可以发信号上报：

| 信号 | 何时发 | 根的行为 |
|------|--------|---------|
| **progress** | 完成一个动作/步骤 | UI 更新 + 转发给其他正在跑的叶子 |
| **found** | 发现计划外信息 | UI 更新 + 转发 + 链式注入到下一步 |
| **blocked** | 已停住/失败 | UI 更新 + step 标记 failed |
| **help** | 自己解决不了 | 第 1 次：派 explore 收集补充<br>第 2 次：升级到人类，等 dteam(continue) |

工具名 `worker_sendSignal`（已注入到所有 worker 角色）。

## 什么时候该用 dteam

| 场景 | 推荐 |
|---|---|
| 简单任务：改一个 typo、解释一段代码、跑一个命令 | 主 LLM 直接做，不调 dteam |
| 复杂任务：需要先探索、再实现、再验证 | 调 `dteam(action="run", goal="...")` |
| 多模块任务：多个文件/模块可并行推进，但要避开冲突 | 调 dteam，让 runtime 用轻量依赖图拆 batch |

示例：

```text
简单任务：把 README 里一个错别字改掉 → 主 LLM 直接改。
复杂任务：重构 UI 面板并补测试 → 调 dteam。
并行避让：同时调整 auth/user 两组逻辑 → 调 dteam；如果 auth.ts imports user.ts，runtime 会让 user.ts 相关 step 先跑。
```

## 文档

> 当前仓库建议按 4 层理解：`index.ts` + `src/` + `agents/` 是运行核心，`tests/` 是验证层，`doc/` 是当前说明层，`archive/` 是历史归档层。重构时优先修改运行核心与当前说明，避免直接从归档倒推实现。

- [设计文档总览](./doc/README.md)
- [系统架构（二维编排模型）](./doc/10-架构与运行/10-系统架构.md)
- [角色系统（5 个角色职责）](./doc/10-架构与运行/11-角色系统.md)
- [工具 API 参考](./doc/10-架构与运行/12-API参考.md)
- [v2 设计与实施现状](./doc/10-架构与运行/13-设计-v2与实施现状.md)
- [项目路线图](./doc/30-路线图/30-项目路线图.md)
- [v0.5.0 轻量依赖图调度与运行态 UI 实施方案](./doc/40-版本实施方案/41-v0.5.0-轻量依赖图调度与运行态UI实施方案.md)
- [工具动态加载方案（已归档）](./doc/90-归档/版本实施方案/41-工具动态加载方案.md)
- [v0.4.1 后台任务稳定性实施方案（已归档）](./doc/90-归档/版本实施方案/42-v0.4.1-后台任务稳定性实施方案.md)
- [多 worker 编排系统参考](./doc/20-能力参考/22-多worker编排系统参考.md)
- [src/ 内部架构](./src/README.md)
- [CHANGELOG.md](./CHANGELOG.md)

## 目录结构

```
.
├── index.ts                 # Pi 扩展入口（注册 dteam 工具 + /dteam 命令）
├── src/
│   ├── orchestrator.ts     # 编排主入口：plan → fileGraph/scheduling → execute → report
│   ├── planner.ts          # Phase 1: 规则判断 + LLM 兜底生成 ExecutionPlan
│   ├── leaf.ts             # Phase 2: 用角色调 LLM 执行（thin coordinator）
│   ├── pool.ts             # 任务池（write/claimNext/update/getAll/read/search/list/complete）
│   ├── session.ts          # createWorkerSession 工厂（78 行 thin coordinator）
│   ├── tools.ts            # 类型中心（编排/角色/ADR 类型 + re-export 4 类 types/*）
│   ├── reference-data.ts   # reference_architecture 工具（12 模式 + ADR 模板）
│   ├── reporter.ts         # Reporter 接口 + defaultReporter（业务/UI 解耦）
│   ├── config.ts           # DTEAM_CONFIG 集中常量
│   ├── signals/            # 信号系统
│   │   ├── index.ts        # 统一导出
│   │   ├── signal-bus.ts   # 内存 Map<workerId, Signal[]> + on() listener
│   │   └── runs-store.ts   # 内存 Map<runId, Map<workerId, WorkerRun>>
│   ├── types/              # 拆出的类型（4 文件）
│   │   ├── signal.ts       # SignalType + 4 payload + Signal
│   │   ├── run.ts          # WorkerRun + ISignalBus + IRunsStore
│   │   ├── role.ts         # RoleName
│   │   └── context.ts      # DteamContext
│   ├── scheduler/          # 0.5.0 轻量 file graph + preflight scheduling
│   ├── ui/                 # UI 模块
│   │   ├── index.ts        # 统一导出
│   │   ├── store.ts        # UIStore 单例（workers/strategies/signals）
│   │   ├── panel.ts        # /dteam 面板（widget + overlay）
│   │   └── helpers.ts      # 状态/信号图标 + duration 格式化
│   ├── session/            # session.ts 拆 5 子文件
│   │   ├── resource-loader.ts
│   │   ├── role-config.ts
│   │   ├── role-prompt.ts
│   │   ├── model-resolver.ts
│   │   └── signal-tool.ts
│   ├── leaf/               # leaf.ts 拆 3 子文件
│   │   ├── worker-id.ts
│   │   ├── extract.ts
│   │   └── supplement.ts
│   └── orchestrator/       # orchestrator.ts 拆 7 子文件
│       ├── signal-handlers.ts
│       ├── help-self-heal.ts
│       ├── peer-forwarder.ts
│       ├── history-context.ts
│       └── strategies/
│           ├── direct.ts
│           ├── build-check.ts
│           ├── adaptive.ts
│           └── index.ts
├── agents/                 # 5 个角色定义（explore / design / build / check / close）
├── tests/                  # 19 个测试文件
├── doc/                    # 所有文档（中文名）
└── archive/                # v0 历史归档
```

## 业务能力

| 功能 | 状态 | 文档 |
|------|------|------|
| 4 种信号（progress/found/blocked/help） | ✅ | `src/signals/signal-bus.ts` |
| 叶子 help → 根派 explore 自愈 | ✅ | `src/orchestrator/help-self-heal.ts` |
| help 第 2 次 → 升级到人类 + 阻塞等回复 | ✅ | `src/index.ts` `action="continue"` |
| 后台运行（action="run" 立即返回 runId） | ✅ | `src/index.ts` |
| 后台运行不再依赖 `onUpdate`（流式更新回调） | ✅ | `index.ts` |
| dteam-report 自动注入主对话（triggerTurn） | ✅ | `src/index.ts` |
| 链式继承（前序发现自动注入到下一步 prompt） | ✅ | `src/orchestrator/history-context.ts` |
| 实时转发（叶子发的 found/progress 自动转发到其他正在跑的叶子） | ✅ | `src/orchestrator/peer-forwarder.ts` |
| reference_architecture 工具（design 角色可用，12 模式 + ADR 模板） | ✅ | `src/reference-data.ts` |
| 3 种 strategy（direct/build_check/adaptive） | ✅ | `src/orchestrator/strategies/` |
| /dteam 面板（概览 / 批次 / Workers / 信号 / 报告） | ✅ | `src/ui/panel.ts` |
| 轻量依赖图调度（fileGraph + scheduling） | ✅ | `src/scheduler/` |
| team 冲突拆批（hard/shared/dependency/unknown） | ✅ | `src/scheduler/preflight.ts` |
| 完成态保留到下一次 run | ✅ | `src/ui/store.ts` / `index.ts` |

## 设计哲学

- **半自动**：人通过 Pi 主对话用 dteam，dteam 不替你拍板
- **二维编排**：组织形式（solo/chain/team）× 执行策略（direct/build_check/adaptive），9 种组合
- **5 个角色**：explore / design / build / check / close，分工明确（build 唯一能改代码）
- **规则优先**：planner 用规则判断（零 LLM 成本），复杂情况才调 LLM
- **信号驱动**：叶子 → 4 种信号 → SignalBus → 根 listener → 实时响应（自愈/转发/链式）
- **后台不卡前台**：dteam 工具立即返回，前台继续工作；完成后自动注入报告
- **人类在环**：help 信号升级到人类，等用户回复后继续
- **MiniMax-M3 优先**：主模型找不到自动降级到 M2.7

## 验证状态

- ✅ v1 核心代码落地 + 重构完成（orchestrator 562→197，session 299→78）
- ✅ `npm run build` 通过
- ✅ `npm test` 可作为当前单元测试基线（19 个测试文件，302 个测试）
- ✅ 4 个真实任务实测通过（solo/chain/team/adaptive 全部命中）
- ✅ 代码主干与历史归档已分层：运行核心 / 说明层 / 归档层边界清晰
- ✅ 信号通路实测通过（progress/found/blocked/help 都能在面板看到）
- ✅ 后台运行 + dteam-report 注入实测通过
- ⏳ 实时转发需更多 task 验证（单元测过）
- ⏳ 0.5.x 后续：按真实痛点评估 status action、doctor、Goal verifier 等轻量增强

## 相关链接

- v0 历史归档：[`archive/v0-pre-rewrite/README-archive.md`](./archive/v0-pre-rewrite/README-archive.md)
- Pi 扩展开发：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
