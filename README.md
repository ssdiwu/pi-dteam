# dteam

> **半自动多角色编排引擎**，作为 Pi 扩展运行。
>
> v1 状态：信号通路 + 后台运行 + 链式/team 模式落地，245 个测试通过，重构完成（orchestrator 562→197 行）。

## 一句话

dteam 把"派一个 worker 干一件事"做成一棵二维编排的 worker 树——**组织形式**（solo / chain / team）× **执行策略**（direct / build_check / adaptive），每个 step 选 5 个角色之一（explore / design / build / check / close）执行。

叶子之间通过 **4 种信号**（progress/found/blocked/help）实时通信，根自动收集并转发、注入上下文，**整棵 worker 树自协调**。

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 编译
npm run build

# 3. 运行测试（245 个用例）
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

### `/dteam` 命令

在 Pi 里输入 `/dteam`：
- 第一次：打开面板（实时显示 worker 进度、信号、策略记录）
- 第二次：关闭面板

### 4 种信号

叶子在跑过程中可以发信号上报：

| 信号 | 何时发 | 根的行为 |
|------|--------|---------|
| **progress** | 完成一个动作/步骤 | UI 更新 + 转发给其他正在跑的叶子 |
| **found** | 发现计划外信息 | UI 更新 + 转发 + 链式注入到下一步 |
| **blocked** | 已停住/失败 | UI 更新 + step 标记 failed |
| **help** | 自己解决不了 | 第 1 次：派 explore 收集补充<br>第 2 次：升级到人类，等 dteam(continue) |

工具名 `worker_sendSignal`（已注入到所有 worker 角色）。

## 文档

- [架构说明（二维编排模型）](./doc/架构说明.md)
- [角色系统（5 个角色职责）](./doc/角色系统.md)
- [工具 API 参考](./doc/API参考.md)
- [src/ 内部架构](./src/README.md)
- [设计文档总览](./doc/README.md)
- [v2 设计 + 实施现状](./doc/设计-v2.md)
- [重构方案 v1（已实施）](./doc/重构方案.md)
- [分支层扩展计划（v2 触发条件）](./doc/分支层扩展计划.md)

## 目录结构

```
.
├── index.ts                 # Pi 扩展入口（注册 dteam 工具 + /dteam 命令）
├── src/
│   ├── orchestrator.ts     # 编排主入口（197 行：plan → execute → report）
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
├── tests/                  # 245 个测试（16 个 test files）
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
| dteam-report 自动注入主对话（triggerTurn） | ✅ | `src/index.ts` |
| 链式继承（前序发现自动注入到下一步 prompt） | ✅ | `src/orchestrator/history-context.ts` |
| 实时转发（叶子发的 found/progress 自动转发到其他正在跑的叶子） | ✅ | `src/orchestrator/peer-forwarder.ts` |
| reference_architecture 工具（design 角色可用，12 模式 + ADR 模板） | ✅ | `src/reference-data.ts` |
| 3 种 strategy（direct/build_check/adaptive） | ✅ | `src/orchestrator/strategies/` |
| /dteam 面板（实时信号 + 策略记录） | ✅ | `src/ui/panel.ts` |

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
- ✅ 245/245 单元测试通过
- ✅ 4 个真实任务实测通过（solo/chain/team/adaptive 全部命中）
- ✅ 信号通路实测通过（progress/found/blocked/help 都能在面板看到）
- ✅ 后台运行 + dteam-report 注入实测通过
- ⏳ 实时转发需更多 task 验证（单元测过）
- ⏳ v1.1：分支层（v2+）

## 相关链接

- v0 历史归档：[`archive/v0-pre-rewrite/README-archive.md`](./archive/v0-pre-rewrite/README-archive.md)
- Pi 扩展开发：<https://github.com/earendil-works/pi-mono/blob/main/packages/coding-agent/doc/extensions.md>
