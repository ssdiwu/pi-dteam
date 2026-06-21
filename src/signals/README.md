# signals/

dteam 的信号系统。Signal Store 是 0.6.0 Orchestrator Loop 的协调面；signal-bus / runs-store 是 0.5.0 桥接残留。

## 文件

| 文件 | 职责 |
|---|---|
| `signal-store.ts` | **0.6.0 主轴**：Signal Store（信号存储，TTL 衰减、单 goal 生命周期）。Orchestrator 每轮从这里读活跃信号做 LLM 决策 |
| `signal-bus.ts` | 0.5.0 信号总线：`ISignalBus` 接口实现，`leaf.execute` 内部 `worker_sendSignal` 通过它上报。0.6.0 在 `orchestrator-loop.ts` 的 `makeBridgeBus` 桥接到 Signal Store |
| `runs-store.ts` | 0.5.0 运行态存储（按 runId 维护 plan/worker/进度/报告）。0.6.0 召唤轨迹自己记在 `summonTrail`，这里被 `makeNoopRunsStore` 替代为空实现 |
| `index.ts` | 导出聚合 |

## 关系

0.6.0 主循环（`orchestrator-loop.ts`）只依赖 `signal-store.ts` 的 `ISignalStore` 接口。`signal-bus.ts` / `runs-store.ts` 是 leaf.execute 桥接层残留，待清理（见探测报告 B 档）。信号语义见 `doc/术语表.md` 的 Signal / Signal Store 条目。

## 0.6.0 口径修正

- ❌ 不再说"后台协作可观察、可中途补充"——0.6.0 是同步前台 Orchestrator Loop（ADR 0005 推翻 ADR 0003）。
- ❌ 不再说"依附 Extension Runtime（见 ADR-0002）"——角色写死是 ADR 0002，Extension Runtime 是已被推翻的 ADR 0003。
- ❌ 不再说"runs-store 被 `/dteam` 面板和 widget 读取"——0.6.0 轨迹记在 `summonTrail`，不是 runs-store。

详见 ADR 0005（召唤池重定义）。