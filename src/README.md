# dteam 内部架构

> 先读 `../doc/README.md` 看用户视角，再读这个看实现细节。
>
> ⚠️ **过渡状态**：定位权威是 [ADR 0008 模型分级路由](../doc/决策档案/0008-dteam重定位为模型分级路由执行层.md)。T1/T2/T3 契约、fresh `dispatch()` 内核、档位路由和并发模块已落地；但 `index.ts` 仍暴露 0.6.0 Orchestrator Loop，旧 signals/五角色尚待后续阶段删除。

## 当前代码现状（0.6.0 形态，待改造）

| 文件 | 0.6.0 职责 | 0008 改造方向 |
|------|------|------|
| `orchestrator-loop.ts` | 0.6.0 Orchestrator Loop 主循环 | **待砍**（主模型自己路由，不要独立 loop） |
| `orchestrator-loop/decision*.ts` | Orchestrator LLM 决策契约 | **待砍**（随 loop 退场） |
| `orchestrator-loop/check-*.ts` | check 收口闸门 | **待改造**为 fresh 验收（dispatch 用法） |
| `dispatch/concurrency.ts` | Adaptive Concurrency | **已迁移保留**，供 dispatch 使用 |
| `dispatch/model-routing.ts` | Multi-Provider Routing | **已迁移保留**，已支持档位路由契约 |
| `signals/signal-store.ts` | 0.6.0 Signal Store | **待砍**（dispatch 是 fan-out + 收结果） |
| `types/loop.ts` | 0.6.0 核心类型 | **待改造**（SummonStep→DispatchResult 等） |
| `leaf.ts` | worker 执行层（进程内 AgentSession） | **已实现** `dispatch(request, ctx)`；旧 role `execute()` 待随 loop 退场 |
| `session.ts` | createWorkerSession 工厂 | **已扩展** tier + thinking；旧 role 兼容待清理 |
| `session/*` | session 子模块（tier-config / role-config / role-prompt / model-resolver / signal-tool / resource-loader） | `tier-config` 已建 T1/T2/T3 契约；旧 role/signal 子模块待退场 |
| `ui/` | UI 模块（store / panel） | **改造**（展示 dispatch + 档位 worker，非 Orchestrator Loop） |
| `reporter.ts` | Reporter 接口 | **保留** |
| `config.ts` | DTEAM_CONFIG 集中常量 | 已新增 dispatch worker timeout；旧 loop 常量待随旧 runtime 收缩 |
| `tools.ts` | 类型中心 | **重写为 dteam_dispatch** |

## 0.6.0 数据流（现状，待按 0008 改造）

```
goal
  ↓
runLoop(goal, ctx)                          [orchestrator-loop.ts]  ← 待砍
  │
  ├─ SignalStore(goalId)                    [signals/signal-store.ts]  ← 待砍
  │
  └─ 循环（每轮）：
       ├─ Orchestrator LLM 决策              ← 0008: 主模型自己路由，不要这个
       ├─ summon(role, task):                ← 0008: 改为 dispatch(tier, task)
       │     ├─ dispatch/model-routing       ← 已迁移，旧 loop 暂时复用
       │     └─ leaf.execute (进程内 AgentSession)  ← 待改为 dispatch 基底
       └─ check: 强制收口                     ← 0008: 改为 fresh 验收（可选）
  ↓
DteamResult6 { summonTrail, signalSnapshot, checkConclusion }  ← 0008: 改为 DispatchResult
```

## 0008 改造进度（进行中）

```
主模型（T1）在对话里路由
  │
  └─ dteam_dispatch(task, tier, thinking?, tools?)    [index.ts + tools.ts]
       │
       ├─ 按 tier 解析模型 + thinking                  [dispatch/model-routing.ts]
       ├─ createAgentSession（进程内，fresh）          [leaf.ts + session.ts]
       │    └─ Logical Isolation（最小 ResourceLoader + 工具白名单）
       ├─ 执行 → 返回结果
       └─ 硬失败自动回退 / 主模型调 fresh 验收（dispatch T1 只读用法）
```

**改造要点**：
1. 砍 `orchestrator-loop.ts` + `signals/*`（0008 推翻 Orchestrator Loop + Signal Store）
2. `leaf.ts`/`session.ts` 已形成 fresh dispatch 内核；对外单工具注册待完成
3. `session/tier-config.ts` 已建立 T1/T2/T3 默认（模型路由 / thinking / 工具白名单）；旧 `role-config.ts` 待删除
4. `dispatch/model-routing.ts` 已迁移为无角色依赖的路由契约；dispatch 接入档位模型配置
5. `index.ts`/`tools.ts` 重写为 `dteam_dispatch`
6. Adaptive Concurrency + Multi-Provider Routing 保留

## 0008 关键不变量（改造后）

1. **单工具 dteam_dispatch**：执行/验收/回退都是它的用法
2. **worker 是 fresh session**：Logical Isolation，dispatch 创建的都不继承主会话
3. **思考跟随档位**：T1高/T2中/T3低，dispatch 可覆盖
4. **T1/T2/T3 三档**：取代五角色
5. **不维护独立 task plan**：主模型在对话里临时路由
6. **不做 resume**（ADR 0004）

## 已退场（0.5.0 → 0.6.0，已完成）

0.5.0 旧二维编排代码（`orchestrator.ts`/`planner.ts`/`pool.ts`/`orchestrator/strategies/*`/`scheduler/*`）已在 0.6.0 删除。

## 已知限制

- **代码 gap**：fresh dispatch 内核已可直接调用，但当前 `index.ts` 仍跑 Orchestrator Loop；对外替换、旧 runtime 退场和真实 Pi 派发验证尚未完成。
- 端到端实测需在有 API key 的 Pi 环境手验。
