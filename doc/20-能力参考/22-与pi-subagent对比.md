# 与 oira666/pi-subagent 对比

> 调研记录。本节只做范式对比和“轻 / 重”评估，**借鉴执行清单（要做 / 暂不做 / 远期）见 [项目路线图.md](./项目路线图.md)**。

- 来源：[https://pi.dev/packages/oira666_pi-subagent](https://pi.dev/packages/oira666_pi-subagent)
- v0.2.28，184.5 KB
- 借鉴参考：ant-colony、`/Users/diwu/.pi/agent/extensions-backup/ant-colony.disabled/`

## 一句话

oira666/pi-subagent 走 **sub-agent 模式**：每个子代理是独立的 `pi` 子进程（OS 级隔离），角色用 `.md` frontmatter 配置，自带持久化、resume、cycle/depth guard、usage 统计、CLI flag 透传。

dteam 走 **team mode 模式**：in-process worker session，二维编排（solo/chain/team × direct/build_check/adaptive），信号系统（help/found/progress/blocked），共享 auth.json。

两条范式不互斥。

## 轻量化校准

> dteam = **轻量化编排引擎**。**不是**所有借鉴项都做——按"轻 / 重"评估后挑选进入路线图。
>
> - **轻**（进路线图"要做"或"暂不做"）：扁平统计、frontmatter 配置、英文正则、steering 广播、depth/cycle guard（评估后暂不做）
> - **重**（路线图"暂不做"或"远期"）：递归 usage tree、check/adaptive 改 tool calling、persistence + resume、进程级隔离、递归分解
>
> 评估标准：改动量 + 当前痛点强度 + 启动 / 维护成本。
> 实际执行清单按 **要做 / 暂不做 / 远期** 三档管理，见 [项目路线图.md](./项目路线图.md)。

## 子代理完成方式

### oira666/pi-subagent

```
subagent(tasks=[{agent, task}])
  → spawn('pi', [...]) 走 JSON-line stdout
  → 每个 task 独立 Node.js 进程
  → 通信：子 agent 最终输出文本（不暴露 tool calls/reasoning）
  → 持久化：sessions-subagents/ 子目录
```

特点：OS 级隔离、子崩不影响主、跨 CPU 核并行、CLI flag 透传 API key。

### dteam

```
dteam(action="run", goal="...")
  → orchestrator.run(goal, ctx)  // 三阶段 Plan/Execute/Report
  → planner.plan(goal)  → ExecutionPlan { mode, steps }
  → executeSteps(steps)
    ├─ solo: 1 个 step
    ├─ chain: 串行 + prevOutput 注入
    └─ team: 分批 ≤ 3 并行
  → runStepWithStrategy(step)
    → STRATEGIES[strategy] (direct/build_check/adaptive)
    → leaf.execute(role, task, ctx, goal)
      → createWorkerSession({...})
        → createAgentSession({...})  // 关键：in-process
        → session.prompt(task)
        → session.messages
      → StepResult
```

特点：in-process 启动快、共享 `modelRegistry.authStorage`、支持 customTools、有显式信号系统。

## 对比表

| 维度 | oira666/pi-subagent | dteam | 备注 |
|------|---------------------|-------|------|
| **进程隔离** | `spawn` 真正 `pi` 子进程 | `createAgentSession` in-process | 关键差异 |
| **崩溃域** | 子崩不影响主 | 子崩 = 主崩 | 推论 |
| **启动开销** | 高（每次 boot Node） | 低（in-process） | 互补 |
| **API key 共享** | CLI flag 透传 `--api-key` | 引用同一 `authStorage` | dteam 赢（不外泄 key） |
| **角色配置** | `.md` frontmatter（model/thinking/tools 全在 frontmatter） | `agents/*.md` 只给 systemPrompt；tools/model/thinking 在 `ROLE_DEFAULTS` 表 | 借鉴 frontmatter 解析 |
| **角色数量** | 3 个（code-writer / code-reviwer / code-architect） | 5 个（explore / design / build / check / close） | |
| **自定义工具** | 只能选 4 个内置（read/bash/edit/write） | 完整 `customTools` API | dteam 赢 |
| **编排模式** | 只支持 parallel | solo/chain/team × direct/build_check/adaptive | dteam 赢 |
| **任务池** | 无 | `TaskPool` (pending/in_progress/done/failed) | dteam 赢 |
| **planner** | 无显式 planner | `planner.ts`（规则 + LLM 兜底） | dteam 赢 |
| **信号系统** | 文本通信 | `SignalBus` (help/found/progress/blocked) + peer forward | dteam 赢 |
| **持久化** | `sessions-subagents/` 子目录 | 全 in-memory | 借鉴 |
| **resume** | TUI 询问 / RPC 自动 | 无 | 借鉴 |
| **depth / cycle guard** | `--subagent-max-depth` + 防环 | 无 | 借鉴（小配置项） |
| **steering 广播** | 给多个子 agent 同时广播 | 单 point 注入 `pendingSupplements` | 借鉴 |
| **usage 统计** | 递归 `usageTree`（含子子子代理） | 无 | 借鉴 |
| **CLI flag 透传** | 显式做了一份透传表 | 共享 `modelRegistry` | 各有取舍 |
| **深度限制** | max-depth = 3（默认） | 无限 | 借鉴 |

## 借鉴清单

> 已抽离到 [项目路线图.md](./项目路线图.md) 的"借鉴 oira666/pi-subagent 的待办"段。本节不维护。

## 不要学

- ❌ 4 个内置工具的硬限制（dteam `customTools` 优势保留）
- ❌ CLI flag 透传 API key（走 `authStorage` 共享更安全）
- ❌ 把整棵 worker 树都 spawn 出去（启动开销会爆；按 leaf 粒度即可）

## 关键不变量（dteam 必须保留）

不管借鉴什么，下面这些是 dteam 的优势，不能丢：

1. **二维编排**（solo/chain/team × direct/build_check/adaptive）
2. **信号系统**（`SignalBus` + peer forward）
3. **共享 `authStorage`**（不暴露 API key）
4. **customTools API**（`decide` / `reference_architecture` / `worker_send_signal` 三大自定义工具）
5. **`planner.ts` 规则 + LLM 兜底**（零成本覆盖 80%）

## 参考实现位置

- 对方 spawn 实现：参考对方 `index.ts` 入口（npm 包已下到 node_modules）
- 对方 session 隔离：`sessions-subagents/` 目录结构
- 对方 usage tree 统计：参考 `SubagentDetails` JSON schema
