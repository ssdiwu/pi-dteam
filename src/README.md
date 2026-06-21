# dteam 内部架构

> 先读 `../README.md` 看用户视角，再读这个看实现细节。
> **0.6.0 已重定义为自发生长召唤池**，骨架权威见 [`../doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md`](../doc/决策档案/0005-dteam-0.6.0-重定义为自发生长召唤池.md)。

## 0.6.0 文件清单

| 文件 | 职责 |
|------|------|
| `orchestrator-loop.ts` | **0.6.0 主循环**：Orchestrator Loop（LLM 驱动每轮决策 → 召唤 → check 收口）。输出契约用 tool calling（orchestrator_decide / check_conclude） |
| `orchestrator-loop/decision.ts` | Orchestrator LLM 的 prompt 构建；`parseOrchestratorDecision` 已废弃（tool calling 上线后无调用点，保留备查） |
| `orchestrator-loop/decision-tool.ts` | **0.6.0 决策输出契约**：orchestrator_decide customTool（LLM 调用即结构化决策，替代 JSON 文本解析） |
| `orchestrator-loop/check-tool.ts` | **0.6.0 收口输出契约**：check_conclude customTool（check worker 调用即结构化 passed/issues，替代关键词猜） |
| `orchestrator-loop/check-gate.ts` | check 收口闸门：`parseCheckResult` 现为 check_conclude 未被调用时的兜底（关键词/JSON 回退） |
| `orchestrator-loop/concurrency.ts` | Adaptive Concurrency（429 自适应升降并发） |
| `orchestrator-loop/model-routing.ts` | Multi-Provider Routing（per-role 主模型 + fallback 链） |
| `signals/signal-store.ts` | **0.6.0 Signal Store**（TTL 衰减、单 goal 生命周期） |
| `types/loop.ts` | **0.6.0 核心类型**（SummonStep/OrchestratorDecision/DteamResult6/ISignalStore） |
| `leaf.ts` | worker 执行层（进程内 AgentSession + Logical Isolation + session.subscribe 双通道） |
| `session.ts` | createWorkerSession 工厂（logicalIsolation 跳过扩展发现） |
| `session/*` | session 子模块（role-config / role-prompt / model-resolver / signal-tool / resource-loader） |
| `signals/signal-bus.ts` / `runs-store.ts` | 0.5.0 信号通路（leaf.execute 内部桥接用） |
| `ui/` | UI 模块（store / panel，0.6.0 最小版；helpers 已删） |
| `reporter.ts` | Reporter 接口 |
| `config.ts` | DTEAM_CONFIG 集中常量 |
| `tools.ts` | 类型中心（0.6.0 纯 re-export；编排类型在 types/loop.ts） |

## 0.6.0 数据流

```
goal
  ↓
runLoop(goal, ctx)                          [orchestrator-loop.ts]
  │
  ├─ SignalStore(goalId)                    [signals/signal-store.ts]
  │
  └─ 循环（每轮）：
       ├─ buildOrchestratorUserPrompt(goal, store.getActive(), summonTrail)
       ├─ Orchestrator LLM 决策（orchestrator_decide tool）   [decision-tool.ts]
       │     → summon / check / done / fail（从 receiver 取结构化决策）
       │     未调 tool → fail 兜底（extractLastText 仅取 reason 上下文）
       │
       ├─ summon(role, task):
       │     ├─ resolveModelWithFallback    [model-routing.ts]
       │     ├─ leaf.execute (进程内 AgentSession + Logical Isolation)
       │     ├─ session.subscribe → 写 SignalStore (双通道)
       │     └─ worker_sendSignal → 桥接 Bus → 写 SignalStore
       │
       ├─ check: runCheck(task) → 注入 check_conclude tool   [check-tool.ts]
       │     从 receiver 取 CheckResult（passed/issues/summary）
       │     worker 未调 tool → 回退 parseCheckResult [check-gate.ts]
       │     passed → done / reject → 继续 (maxCheckRetries)
       │
       └─ parallel>1: summonParallel (AdaptiveConcurrency 调控)
  ↓
DteamResult6 { summonTrail, signalSnapshot, checkConclusion, ... }
```

## 0.6.0 关键不变量

1. **goal 驱动自发生长**：无预先 Task Plan，召唤轨迹（summonTrail）即计划
2. **强制 check 收口**：Orchestrator 不能自停，goal 必须经 check 通过（Completion Gate）
3. **进程内 worker + Logical Isolation**：`SessionManager.inMemory()` + 最小 ResourceLoader（不 discover extensions）+ 工具白名单
4. **Signal Store TTL 衰减**：新信号优先，旧信号过期，单 goal 生命周期
5. **build 唯一能改代码**：`getRoleTools("build")` 含 edit，其他角色不含
6. **Adaptive Concurrency**：429 降并发，连续成功升并发，受 ConcurrencyConfig 调控
7. **Multi-Provider Routing**：每角色可配主模型 + fallback 链，避免单供应商并发墙

## 0.5.0 → 0.6.0 已退场

以下 0.5.0 代码已在 0.6.0 删除（Phase 5）：
- `orchestrator.ts`（旧 Plan→Execute→Report 二维编排）→ 被 `orchestrator-loop.ts` 取代
- `planner.ts`（规则 + LLM JSON 穷举）→ 被 LLM-Driven Orchestration 取代
- `pool.ts`（TaskPool）→ summonTrail 自记轨迹
- `orchestrator/strategies/*`（direct/build_check/adaptive）→ Orchestrator LLM 决策取代
- `orchestrator/history-context.ts`（chain 继承）→ chain 模式已删
- `orchestrator/signal-handlers.ts` / `help-self-heal.ts` / `peer-forwarder.ts` → Signal Store + Orchestrator 内部自愈
- `scheduler/*`（file-graph + preflight）→ 降级，不再是编排核心

## 已完成的清理（0.6.0 Phase 5）

以下 0.5.0 遗留在 Phase 5 已全部清除，本节作为完成记录：
- `tools.ts` 旧二维编排类型（ExecutionPlan/PlanStep/SchedulingPlan/ExecMode/Strategy 等）已删，tools.ts 重写为纯 re-export
- `ui/store.ts` 已删 mode/scheduling/strategies 字段；`ui/panel.ts` 重写为最小 worker 展示；`ui/helpers.ts` 已删
- `reporter.ts` 降级为 no-op（删 setPlan/setScheduling）
- `index.ts` 0.5.0 旧渲染分支（running/RunResult/plan/scheduling）+ dteam-report 消息渲染器已删

## 已知限制

- 端到端实测（真实 LLM 跑通 `/dteam <goal>`）需在有 API key 的 Pi 环境手动验证；单测用 vi.mock 验证决策流转/并发/路由逻辑
- `ui/store.ts` / `ui/panel.ts` 是最小 worker 展示，尚未改为 Orchestrator Loop 推进 + SignalStore 快照展示（后续 UI 增强）
